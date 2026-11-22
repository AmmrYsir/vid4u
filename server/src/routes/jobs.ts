import { createReadStream } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '../config.js'
import { AppError } from '../services/errors.js'
import type { JobManager } from '../services/jobs.js'
import { resolvePreset } from '../services/presets.js'
import {
  assertAllowedUrl,
  contentDisposition,
  verifyDownloadToken,
} from '../services/security.js'

interface CreateJobBody {
  token?: unknown
  presetId?: unknown
}

interface JobParams {
  id: string
}

export function registerJobRoutes(
  app: FastifyInstance,
  config: AppConfig,
  jobs: JobManager,
): void {
  app.post(
    '/api/jobs',
    {
      config: {
        rateLimit: {
          max: config.rateLimitJobs,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const body = request.body as CreateJobBody | null
      if (!body || typeof body.token !== 'string' || typeof body.presetId !== 'string') {
        throw new AppError('invalid_token', 'The download request is incomplete.', 400, {
          hint: 'Find the video again.',
        })
      }

      const payload = verifyDownloadToken(body.token, config.signingSecret)
      // Re-validate the signed URL so an old token cannot outlive a config change.
      const url = assertAllowedUrl(payload.u, config.allowedHosts)
      resolvePreset(body.presetId)

      const job = await jobs.create({
        url: url.toString(),
        presetId: body.presetId,
        title: payload.t,
        mediaId: payload.i,
      })

      reply.code(202)
      return job
    },
  )

  app.get<{ Params: JobParams }>('/api/jobs/:id', async (request) => {
    const job = jobs.get(request.params.id)
    if (!job) {
      throw new AppError('not_found', 'That download could not be found.', 404, {
        hint: 'It may have expired. Find the video again.',
      })
    }
    return job
  })

  app.get<{ Params: JobParams }>('/api/jobs/:id/file', async (request, reply) => {
    const file = jobs.getFile(request.params.id)
    const contentTypes: Record<string, string> = {
      mp4: 'video/mp4',
      webm: 'video/webm',
      mkv: 'video/x-matroska',
      mov: 'video/quicktime',
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
    }
    reply.header('Content-Type', contentTypes[file.ext] ?? 'application/octet-stream')
    reply.header('Content-Length', String(file.size))
    reply.header('Content-Disposition', contentDisposition(file.filename))
    reply.header('Cache-Control', 'no-store')
    return reply.send(createReadStream(file.path))
  })

  app.delete<{ Params: JobParams }>('/api/jobs/:id', async (request) => {
    const canceled = await jobs.cancel(request.params.id)
    if (!canceled) {
      throw new AppError('not_found', 'That download could not be found.', 404)
    }
    return { ok: true }
  })
}
