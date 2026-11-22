import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { AppConfig } from '../config.js'
import { AppError } from './errors.js'
import { killProcessTree } from './process.js'
import { resolvePreset, type YtInfo } from './presets.js'

const MAX_STDOUT_BYTES = 20 * 1024 * 1024
const MAX_STDERR_BYTES = 1024 * 1024
const OUTPUT_IGNORE = /\.(part|ytdl|temp|json|jpe?g|png|webp|vtt|srt|ass|description)$/i

interface RunOptions {
  timeoutMs: number
  signal?: AbortSignal
  onStdoutLine?: (line: string) => void
}

interface RunResult {
  stdout: string
  stderr: string
  code: number | null
}

export interface DownloadResult {
  filePath: string
  ext: string
}

function toolsMissing(): AppError {
  return new AppError('tools_missing', 'The download tools are not installed on the server.', 503, {
    hint: 'Run "pnpm setup:tools" on the server and restart it.',
  })
}

export function mapYtDlpError(stderr: string): AppError {
  const text = stderr.toLowerCase()

  if (/confirm you.{0,20}not a bot|sign in to confirm|login required|log in to|requires authentication|cookies/i.test(text)) {
    return new AppError('login_required', 'This video needs a logged-in session.', 422, {
      hint: 'Instagram and some Facebook or YouTube videos require cookies. Try a public post, or configure COOKIES_FILE on the server.',
      detail: stderr.slice(-2000),
    })
  }
  if (/larger than max-filesize|file is larger than|max-filesize/i.test(text)) {
    return new AppError('too_big', 'That file is larger than the server limit.', 422, {
      hint: 'Try a lower quality or a shorter video.',
      detail: stderr.slice(-2000),
    })
  }
  if (/private video|this video is private|members-only|has been removed|deleted|does not exist|this video is unavailable|video is not available/i.test(text)) {
    return new AppError('private', 'This video is private or unavailable.', 422, {
      hint: 'Only public videos can be downloaded.',
      detail: stderr.slice(-2000),
    })
  }
  if (/unsupported url|no suitable extractor|is not a valid url/i.test(text)) {
    return new AppError('unsupported', 'This site is not supported yet.', 422, {
      detail: stderr.slice(-2000),
    })
  }
  if (/live event|is live|live stream/i.test(text)) {
    return new AppError('live_unsupported', 'Live streams are not supported.', 422, {
      detail: stderr.slice(-2000),
    })
  }
  if (/requested format is not available|no video formats found|no formats found/i.test(text)) {
    return new AppError('format_unavailable', 'That quality is no longer available.', 422, {
      hint: 'Find the video again to refresh the available qualities.',
      detail: stderr.slice(-2000),
    })
  }
  if (/429|too many requests|rate.?limit/i.test(text)) {
    return new AppError('rate_limited', 'The platform is rate-limiting requests.', 429, {
      hint: 'Wait a minute and try again.',
      detail: stderr.slice(-2000),
    })
  }
  if (/timed out|timeout/i.test(text)) {
    return new AppError('timeout', 'The platform took too long to respond.', 504, {
      detail: stderr.slice(-2000),
    })
  }

  return new AppError('extractor_failed', 'The platform did not return a downloadable video.', 502, {
    hint: 'The link may be region-locked or the platform changed. Try again later.',
    detail: stderr.slice(-2000),
  })
}

export class YtDlp {
  constructor(private readonly config: AppConfig) {}

  get binaryPath(): string {
    return this.config.ytdlpPath
  }

  get ffmpegPath(): string {
    return this.config.ffmpegPath
  }

  private networkArgs(): string[] {
    const args: string[] = []
    if (this.config.cookiesFile) args.push('--cookies', this.config.cookiesFile)
    if (this.config.proxyUrl) args.push('--proxy', this.config.proxyUrl)
    return args
  }

  private run(args: string[], options: RunOptions): Promise<RunResult> {
    const runtimeDir = join(this.config.tempDir, '.runtime', `run-${randomUUID()}`)
    mkdirSync(runtimeDir, { recursive: true })

    return new Promise((resolve, reject) => {
      let child: ChildProcess | undefined
      let stdout = ''
      let stderr = ''
      let stdoutRemainder = ''
      let stderrRemainder = ''
      let settled = false
      let timedOut = false
      let aborted = false
      let abortFallback: NodeJS.Timeout | undefined

      const finish = (error?: AppError, result?: RunResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (abortFallback) clearTimeout(abortFallback)
        options.signal?.removeEventListener('abort', onAbort)
        void this.removeRuntime(runtimeDir)
        if (error) reject(error)
        else resolve(result as RunResult)
      }

      const timer = setTimeout(() => {
        timedOut = true
        killProcessTree(child?.pid)
      }, options.timeoutMs)

      const onAbort = () => {
        if (settled) return
        aborted = true
        killProcessTree(child?.pid)
        // Wait for 'close' so the process releases its files before the job
        // directory is removed. Fall back if Windows never reports close.
        abortFallback = setTimeout(() => {
          finish(new AppError('timeout', 'The download was canceled.', 499, { detail: 'aborted' }))
        }, 5000)
      }

      if (options.signal?.aborted) {
        finish(new AppError('timeout', 'The download was canceled.', 499, { detail: 'aborted' }))
        return
      }
      options.signal?.addEventListener('abort', onAbort, { once: true })

      try {
        child = spawn(this.binaryPath, args, {
          windowsHide: true,
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            // Keep PyInstaller extraction in a per-run directory. Windows can
            // hold the job output folder open after a cancel, and this avoids
            // mixing runtime files with the media being downloaded.
            TEMP: runtimeDir,
            TMP: runtimeDir,
            TMPDIR: runtimeDir,
            PYTHONUTF8: '1',
            NO_COLOR: '1',
          },
        })
      } catch (error) {
        finish(
          new AppError('extractor_failed', 'Could not start the download engine.', 500, {
            detail: error instanceof Error ? error.message : String(error),
          }),
        )
        return
      }

      const emitLines = (chunk: string, stream: 'stdout' | 'stderr') => {
        if (stream === 'stdout') {
          stdout += chunk
          stdoutRemainder += chunk
          const lines = stdoutRemainder.split(/\r?\n/)
          stdoutRemainder = lines.pop() ?? ''
          for (const line of lines) options.onStdoutLine?.(line)
          if (stdout.length > MAX_STDOUT_BYTES) {
            killProcessTree(child?.pid)
            finish(
              new AppError('extractor_failed', 'The platform returned too much data.', 502),
            )
          }
          return
        }

        stderr += chunk
        stderrRemainder += chunk
        const lines = stderrRemainder.split(/\r?\n/)
        stderrRemainder = lines.pop() ?? ''
        if (stderr.length > MAX_STDERR_BYTES) {
          stderr = stderr.slice(-MAX_STDERR_BYTES)
        }
      }

      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => emitLines(chunk, 'stdout'))
      child.stderr?.on('data', (chunk: string) => emitLines(chunk, 'stderr'))

      child.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          finish(toolsMissing())
        } else {
          finish(
            new AppError('extractor_failed', 'The download engine could not start.', 500, {
              detail: error.message,
            }),
          )
        }
      })

      child.on('close', (code) => {
        void this.removeRuntime(runtimeDir)
        if (settled) return
        if (stdoutRemainder) options.onStdoutLine?.(stdoutRemainder)
        if (timedOut) {
          finish(
            new AppError('timeout', 'The platform took too long to respond.', 504, {
              detail: stderr.slice(-2000),
            }),
          )
          return
        }
        if (aborted) {
          finish(new AppError('timeout', 'The download was canceled.', 499, { detail: 'aborted' }))
          return
        }
        if (code === 0) {
          finish(undefined, { stdout, stderr, code })
          return
        }
        finish(mapYtDlpError(stderr))
      })
    })
  }

  private async removeRuntime(directory: string): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await rm(directory, { recursive: true, force: true })
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
      }
    }
  }

  async resolve(url: string): Promise<YtInfo> {
    const args = [
      '--ignore-config',
      '--dump-single-json',
      '--skip-download',
      '--no-playlist',
      '--no-warnings',
      '--no-colors',
      '--no-cache-dir',
      '--socket-timeout',
      '15',
      '--extractor-retries',
      '2',
      ...this.networkArgs(),
      url,
    ]

    const result = await this.run(args, {
      timeoutMs: this.config.resolveTimeoutMs,
    })

    const raw = result.stdout.trim()
    if (!raw) {
      throw new AppError('extractor_failed', 'The platform returned no video information.', 502, {
        detail: result.stderr.slice(-2000),
      })
    }

    let info: YtInfo
    try {
      info = JSON.parse(raw) as YtInfo
    } catch {
      throw new AppError('extractor_failed', 'The platform returned an unexpected response.', 502, {
        detail: raw.slice(0, 1000),
      })
    }

    if (info._type === 'playlist' || (Array.isArray(info.entries) && !info.formats)) {
      throw new AppError('playlist_unsupported', 'Playlists are not supported.', 422, {
        hint: 'Paste a single video or reel link.',
      })
    }
    if (info.is_live || info.live_status === 'is_live' || info.live_status === 'is_upcoming') {
      throw new AppError('live_unsupported', 'Live streams are not supported.', 422)
    }
    if (
      typeof info.duration === 'number' &&
      info.duration > this.config.maxDurationSeconds
    ) {
      const minutes = Math.round(this.config.maxDurationSeconds / 60)
      throw new AppError('too_long', `Videos longer than ${minutes} minutes are not supported.`, 422, {
        hint: 'Try a shorter clip.',
      })
    }

    return info
  }

  async download(
    url: string,
    presetId: string,
    outputDir: string,
    onStdoutLine: (line: string) => void,
    signal?: AbortSignal,
  ): Promise<DownloadResult> {
    const preset = resolvePreset(presetId)
    const args = [
      '--ignore-config',
      '--no-playlist',
      '--newline',
      '--no-colors',
      '--no-warnings',
      '--no-mtime',
      '--no-cache-dir',
      '--no-write-info-json',
      '--no-write-thumbnail',
      '--no-write-subs',
      '--socket-timeout',
      '20',
      '--retries',
      '3',
      '--fragment-retries',
      '3',
      '--max-filesize',
      `${this.config.maxFilesizeMb}M`,
      '--ffmpeg-location',
      this.config.ffmpegPath,
      '-o',
      join(outputDir, 'media.%(ext)s'),
      ...(preset.audioOnly
        ? ['-x', '--audio-format', 'mp3', '--audio-quality', '0']
        : ['--merge-output-format', 'mp4']),
      '-f',
      preset.formatSelector,
      ...this.networkArgs(),
      url,
    ]

    await this.run(args, {
      timeoutMs: this.config.downloadTimeoutMs,
      signal,
      onStdoutLine,
    })

    const entries = await readdir(outputDir, { withFileTypes: true })
    const candidates = entries
      .filter((entry) => entry.isFile() && !OUTPUT_IGNORE.test(entry.name))
      .map((entry) => join(outputDir, entry.name))

    if (candidates.length === 0) {
      throw new AppError('extractor_failed', 'The download finished without a file.', 502)
    }

    const sized = await Promise.all(
      candidates.map(async (filePath) => ({ filePath, size: (await stat(filePath)).size })),
    )
    const largest = sized.sort((a, b) => b.size - a.size)[0]
    if (!largest || largest.size === 0) {
      throw new AppError('extractor_failed', 'The downloaded file is empty.', 502)
    }

    return { filePath: largest.filePath, ext: extname(largest.filePath).slice(1).toLowerCase() }
  }

  async version(): Promise<string | null> {
    try {
      const result = await this.run(['--version'], {
        timeoutMs: 10_000,
      })
      return result.stdout.trim() || null
    } catch {
      return null
    }
  }
}
