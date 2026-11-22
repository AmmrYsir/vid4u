import { randomUUID } from 'node:crypto'
import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyBaseLogger } from 'fastify'
import PQueue from 'p-queue'
import type { AppConfig } from '../config.js'
import { AppError, internalError, isAppError, type ErrorCode } from './errors.js'
import { safeFilename } from './security.js'
import type { YtDlp } from './ytdlp.js'

export type JobStatus = 'queued' | 'downloading' | 'processing' | 'ready' | 'error' | 'canceled'

export interface JobError {
  code: ErrorCode
  message: string
  hint?: string
}

export interface JobPublic {
  id: string
  status: JobStatus
  stage: string
  progress: number
  title: string
  expiresAt: string
  filename?: string
  sizeBytes?: number
  error?: JobError
  fileUrl?: string
}

export interface JobFile {
  path: string
  filename: string
  size: number
  ext: string
}

interface InternalJob {
  id: string
  url: string
  presetId: string
  title: string
  mediaId: string
  status: JobStatus
  stage: string
  progress: number
  expiresAt: number
  createdAt: number
  tempDir: string
  filePath?: string
  filename?: string
  sizeBytes?: number
  error?: JobError
  canceled: boolean
  controller: AbortController
}

export interface CreateJobInput {
  url: string
  presetId: string
  title: string
  mediaId: string
}

export class JobManager {
  private readonly jobs = new Map<string, InternalJob>()
  private readonly queue: PQueue
  private readonly cleanupTimer: NodeJS.Timeout

  constructor(
    private readonly config: AppConfig,
    private readonly ytdlp: YtDlp,
    private readonly logger: FastifyBaseLogger,
  ) {
    this.queue = new PQueue({ concurrency: config.maxConcurrentJobs })
    this.cleanupTimer = setInterval(() => void this.cleanupExpired(), 60_000)
    this.cleanupTimer.unref()
  }

  get queueSize(): number {
    return this.queue.size
  }

  private toPublic(job: InternalJob): JobPublic {
    return {
      id: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      title: job.title,
      expiresAt: new Date(job.expiresAt).toISOString(),
      ...(job.filename ? { filename: job.filename } : {}),
      ...(typeof job.sizeBytes === 'number' ? { sizeBytes: job.sizeBytes } : {}),
      ...(job.error ? { error: job.error } : {}),
      ...(job.status === 'ready' ? { fileUrl: `/api/jobs/${job.id}/file` } : {}),
    }
  }

  async create(input: CreateJobInput): Promise<JobPublic> {
    if (this.queue.size >= this.config.maxQueuedJobs) {
      throw new AppError('busy', 'The server is busy right now.', 429, {
        hint: 'Wait a few seconds and try again.',
      })
    }

    const id = `j_${randomUUID()}`
    const job: InternalJob = {
      id,
      url: input.url,
      presetId: input.presetId,
      title: input.title,
      mediaId: input.mediaId,
      status: 'queued',
      stage: 'Waiting in queue',
      progress: 0,
      expiresAt: Date.now() + this.config.jobTtlMs,
      createdAt: Date.now(),
      tempDir: join(this.config.tempDir, id),
      canceled: false,
      controller: new AbortController(),
    }

    this.jobs.set(id, job)
    void this.queue
      .add(() => this.run(job))
      .catch((error: unknown) => {
        this.logger.error({ jobId: id, error }, 'Unexpected job queue failure')
      })

    return this.toPublic(job)
  }

  get(id: string): JobPublic | null {
    const job = this.jobs.get(id)
    return job ? this.toPublic(job) : null
  }

  getFile(id: string): JobFile {
    const job = this.jobs.get(id)
    if (!job) {
      throw new AppError('not_found', 'That download could not be found.', 404, {
        hint: 'It may have expired. Find the video again.',
      })
    }
    if (job.status !== 'ready' || !job.filePath || !job.filename) {
      throw new AppError('not_ready', 'The file is not ready yet.', 409, {
        hint: 'Wait until the download finishes.',
      })
    }
    return {
      path: job.filePath,
      filename: job.filename,
      size: job.sizeBytes ?? 0,
      ext: job.filename.split('.').pop()?.toLowerCase() ?? 'mp4',
    }
  }

  async cancel(id: string): Promise<boolean> {
    const job = this.jobs.get(id)
    if (!job) return false
    const active = job.status === 'downloading' || job.status === 'processing'
    job.canceled = true
    job.controller.abort()
    job.status = 'canceled'
    job.stage = 'Canceled'
    job.progress = 0
    job.error = undefined
    // Active jobs clean up after the child process closes; removing the folder
    // early hits Windows file locks.
    if (!active) await this.removeTemp(job)
    return true
  }

  private onLine(job: InternalJob, line: string): void {
    if (job.canceled) return

    const percent = /\[download\]\s+([\d.]+)%/.exec(line)
    if (percent) {
      const value = Number.parseFloat(percent[1])
      job.status = 'downloading'
      job.stage = 'Downloading media'
      job.progress = Math.max(job.progress, Math.min(90, Math.round(value * 0.9)))
      return
    }

    if (/\[Merger\]|Merging formats/i.test(line)) {
      job.status = 'processing'
      job.stage = 'Merging audio and video'
      job.progress = 95
      return
    }

    if (/\[ExtractAudio\]|Extracting audio/i.test(line)) {
      job.status = 'processing'
      job.stage = 'Converting to MP3'
      job.progress = 95
      return
    }

    if (/\[download\] Destination:/i.test(line)) {
      job.status = 'downloading'
      job.stage = 'Downloading media'
      job.progress = Math.max(job.progress, 2)
    }
  }

  private async run(job: InternalJob): Promise<void> {
    if (job.canceled) {
      job.status = 'canceled'
      job.stage = 'Canceled'
      return
    }

    job.status = 'downloading'
    job.stage = 'Starting download'
    job.progress = 1

    try {
      await mkdir(job.tempDir, { recursive: true })
      const result = await this.ytdlp.download(
        job.url,
        job.presetId,
        job.tempDir,
        (line) => this.onLine(job, line),
        job.controller.signal,
      )

      if (job.canceled) {
        job.status = 'canceled'
        job.stage = 'Canceled'
        await this.removeTemp(job)
        return
      }

      // The job may have expired out of the map while it was running.
      if (!this.jobs.has(job.id)) {
        await this.removeTemp(job)
        return
      }

      const info = await stat(result.filePath)
      const maxBytes = this.config.maxFilesizeMb * 1024 * 1024
      if (info.size > maxBytes) {
        throw new AppError('too_big', 'That file is larger than the server limit.', 422, {
          hint: `Downloads are capped at ${this.config.maxFilesizeMb} MB. Try a lower quality.`,
        })
      }
      job.filePath = result.filePath
      job.filename = safeFilename(job.title, job.mediaId, result.ext)
      job.sizeBytes = info.size
      job.status = 'ready'
      job.stage = 'Ready to save'
      job.progress = 100
      job.expiresAt = Date.now() + this.config.jobTtlMs
    } catch (error) {
      if (job.canceled) {
        job.status = 'canceled'
        job.stage = 'Canceled'
        await this.removeTemp(job)
        return
      }

      const appError = isAppError(error)
        ? error
        : internalError(error instanceof Error ? error.message : String(error))

      job.status = 'error'
      job.stage = 'Download failed'
      job.progress = 0
      job.error = {
        code: appError.code,
        message: appError.message,
        ...(appError.hint ? { hint: appError.hint } : {}),
      }
      await this.removeTemp(job)

      this.logger.warn(
        {
          jobId: job.id,
          code: appError.code,
          detail: appError.detail?.split(job.url).join('[url]').slice(0, 800),
        },
        'Download job failed',
      )
    }
  }

  private async removeTemp(job: InternalJob): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(job.tempDir, { recursive: true, force: true })
        return
      } catch (error) {
        if (attempt === 4) {
          this.logger.warn({ jobId: job.id, error }, 'Could not remove job temp directory')
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)))
      }
    }
  }

  private async cleanupExpired(): Promise<void> {
    const now = Date.now()
    for (const [id, job] of this.jobs) {
      if (job.expiresAt > now) continue
      const active = job.status === 'downloading' || job.status === 'processing'
      job.canceled = true
      job.controller.abort()
      if (!active) await this.removeTemp(job)
      this.jobs.delete(id)
    }
  }

  async shutdown(): Promise<void> {
    clearInterval(this.cleanupTimer)
    await this.queue.clear()
    for (const job of this.jobs.values()) {
      job.canceled = true
      job.controller.abort()
      await this.removeTemp(job)
    }
    this.jobs.clear()
  }
}
