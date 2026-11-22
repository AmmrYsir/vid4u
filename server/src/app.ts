import fastifyStatic from '@fastify/static'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import type { AppConfig } from './config.js'
import { registerHealthRoute } from './routes/health.js'
import { registerJobRoutes } from './routes/jobs.js'
import { registerResolveRoute } from './routes/resolve.js'
import {
  AppError,
  internalError,
  isAppError,
  toPublicErrorBody,
} from './services/errors.js'
import { JobManager } from './services/jobs.js'
import { ToolChecker } from './services/tools.js'
import { YtDlp } from './services/ytdlp.js'

export interface BuildAppOptions {
  config: AppConfig
  ytdlp?: YtDlp
  jobs?: JobManager
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options
  const app = Fastify({
    logger:
      config.nodeEnv === 'test'
        ? false
        : {
            level: config.logLevel,
            redact: ['req.headers.authorization', 'req.headers.cookie'],
          },
    trustProxy: config.trustProxy,
    bodyLimit: 16 * 1024,
  })

  const ytdlp = options.ytdlp ?? new YtDlp(config)
  const jobs = options.jobs ?? new JobManager(config, ytdlp, app.log)
  const tools = new ToolChecker(config, ytdlp)

  await app.register(rateLimit, { global: false })

  registerHealthRoute(app, tools)
  registerResolveRoute(app, config, ytdlp)
  registerJobRoutes(app, config, jobs)

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({
        error: { code: 'not_found', message: 'That API route does not exist.' },
      })
    }
    if (config.serveStatic && (request.method === 'GET' || request.method === 'HEAD')) {
      return reply.type('text/html').sendFile('index.html')
    }
    return reply
      .code(404)
      .type('text/plain')
      .send('vid4u API is running. Start Vite for the web app, or build it first.')
  })

  app.setErrorHandler((error, request, reply) => {
    if (isAppError(error)) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error, code: error.code }, 'Request failed')
      }
      return reply.code(error.statusCode).send(toPublicErrorBody(error))
    }

    const fastifyError = error as FastifyError
    if (fastifyError.validation) {
      return reply.code(400).send(
        toPublicErrorBody(
          new AppError('invalid_url', 'The request was invalid.', 400, {
            hint: 'Check the link and try again.',
          }),
        ),
      )
    }

    // Fastify's own 4xx errors (empty JSON body, unsupported media type,
    // payload too large, etc.) should stay 4xx rather than becoming a 500.
    if (
      typeof fastifyError.statusCode === 'number' &&
      fastifyError.statusCode >= 400 &&
      fastifyError.statusCode < 500
    ) {
      request.log.warn({ err: error }, 'Rejected malformed request')
      return reply.code(fastifyError.statusCode).send(
        toPublicErrorBody(
          new AppError('invalid_request', 'The request could not be processed.', fastifyError.statusCode, {
            hint: 'Refresh the page and try again.',
          }),
        ),
      )
    }

    request.log.error({ err: error }, 'Unhandled request error')
    return reply.code(500).send(toPublicErrorBody(internalError()))
  })

  // Register the static wildcard last and after the custom error handler:
  // @fastify/static snapshots fastify.errorHandler for its route, so ordering
  // here keeps API errors in the public JSON envelope.
  if (config.serveStatic) {
    await app.register(fastifyStatic, {
      root: config.distDir,
      prefix: '/',
    })
  }

  app.addHook('onClose', async () => {
    if (!options.jobs) {
      await jobs.shutdown()
    }
  })

  return app
}
