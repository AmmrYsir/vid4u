import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '../config.js'
import { AppError } from '../services/errors.js'
import { buildPresets, pickThumbnail } from '../services/presets.js'
import { assertAllowedUrl, platformForUrl, signDownloadToken } from '../services/security.js'
import type { YtDlp } from '../services/ytdlp.js'

interface ResolveBody {
  url?: unknown
}

export function registerResolveRoute(
  app: FastifyInstance,
  config: AppConfig,
  ytdlp: YtDlp,
): void {
  app.post(
    '/api/resolve',
    {
      config: {
        rateLimit: {
          max: config.rateLimitResolve,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const body = request.body as ResolveBody | null
      if (!body || typeof body.url !== 'string') {
        throw new AppError('invalid_url', 'Paste a video link to get started.', 400)
      }

      const url = assertAllowedUrl(body.url, config.allowedHosts)
      const info = await ytdlp.resolve(url.toString())
      const platform = platformForUrl(url)
      const presets = buildPresets(info)

      if (presets.length === 0) {
        throw new AppError('no_formats', 'No downloadable formats were found.', 422, {
          hint: 'The post may be a photo, story or unsupported media type.',
        })
      }

      const title =
        (typeof info.title === 'string' && info.title.trim()) || 'Untitled video'
      const mediaId = String(info.id ?? 'video')
      const thumbnail = pickThumbnail(info)
      const signed = signDownloadToken(
        { url: url.toString(), title, mediaId },
        config.signingSecret,
        config.tokenTtlMs,
      )

      reply.header('Cache-Control', 'no-store')
      return {
        video: {
          platform: platform.id,
          platformLabel: platform.label,
          id: mediaId,
          title,
          ...(typeof (info.uploader ?? info.channel ?? info.creator) === 'string'
            ? { uploader: info.uploader ?? info.channel ?? info.creator }
            : {}),
          ...(typeof info.duration === 'number' ? { duration: info.duration } : {}),
          ...(thumbnail ? { thumbnail } : {}),
          webpageUrl: typeof info.webpage_url === 'string' ? info.webpage_url : url.toString(),
        },
        presets,
        token: signed.token,
        expiresAt: signed.expiresAt.toISOString(),
      }
    },
  )
}
