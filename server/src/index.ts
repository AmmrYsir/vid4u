import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()
const app = await buildApp({ config })

if (!existsSync(config.ytdlpPath)) {
  app.log.warn(
    { path: config.ytdlpPath },
    'yt-dlp was not found. Run "pnpm setup:tools" before resolving links.',
  )
}
if (isAbsolute(config.ffmpegPath) && !existsSync(config.ffmpegPath)) {
  app.log.warn({ path: config.ffmpegPath }, 'FFmpeg was not found; merging and MP3 will fail.')
}
if (config.signingSecretGenerated) {
  app.log.warn(
    'SIGNING_SECRET is not set; using a temporary secret. Download tokens will expire on restart.',
  )
}

try {
  await app.listen({ port: config.port, host: config.host })
  app.log.info(
    {
      api: `http://${config.host}:${config.port}`,
      static: config.serveStatic ? config.distDir : 'disabled (dev)',
    },
    'vid4u API is ready',
  )
} catch (error) {
  app.log.error(error)
  process.exit(1)
}

let closing = false
async function shutdown(signal: string): Promise<void> {
  if (closing) return
  closing = true
  app.log.info({ signal }, 'Shutting down')
  try {
    await app.close()
  } finally {
    process.exit(0)
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
