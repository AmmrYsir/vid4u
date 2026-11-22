import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpegStatic from 'ffmpeg-static'
import { DEFAULT_ALLOWED_HOSTS } from './constants.js'

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const envFile = join(PROJECT_ROOT, '.env')
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile)
  } catch {
    // A malformed .env should not stop the API from booting with defaults.
  }
}

export interface AppConfig {
  rootDir: string
  port: number
  host: string
  nodeEnv: 'development' | 'production' | 'test'
  logLevel: string
  signingSecret: string
  signingSecretGenerated: boolean
  ytdlpPath: string
  ffmpegPath: string
  cookiesFile: string | null
  proxyUrl: string | null
  allowedHosts: string[]
  tempDir: string
  distDir: string
  serveStatic: boolean
  trustProxy: boolean
  maxDurationSeconds: number
  maxFilesizeMb: number
  maxConcurrentJobs: number
  maxQueuedJobs: number
  jobTtlMs: number
  tokenTtlMs: number
  resolveTimeoutMs: number
  downloadTimeoutMs: number
  rateLimitResolve: number
  rateLimitJobs: number
}

function readInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value < min || value > max) return fallback
  return value
}

function readPath(name: string, fallback: string): string {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  return isAbsolute(raw) ? raw : resolve(PROJECT_ROOT, raw)
}

function readList(name: string, fallback: string[]): string[] {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const values = raw
    .split(',')
    .map((value) => value.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean)
  return values.length > 0 ? [...new Set(values)] : fallback
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const nodeEnv = (process.env.NODE_ENV as AppConfig['nodeEnv']) || 'development'
  const isProduction = nodeEnv === 'production'
  const generatedSecret = randomBytes(32).toString('hex')
  const secretFromEnv = process.env.SIGNING_SECRET?.trim()
  if (isProduction && !secretFromEnv) {
    throw new Error('SIGNING_SECRET is required when NODE_ENV=production.')
  }

  const defaultYtdlp =
    process.platform === 'win32'
      ? join(PROJECT_ROOT, 'server', 'bin', 'yt-dlp.exe')
      : join(PROJECT_ROOT, 'server', 'bin', 'yt-dlp')
  const defaultFfmpeg = (ffmpegStatic as string | null | undefined) || 'ffmpeg'
  const tempDir = readPath('TEMP_DIR', join(PROJECT_ROOT, 'server', '.tmp'))
  mkdirSync(tempDir, { recursive: true })

  const distDir = join(PROJECT_ROOT, 'dist')
  const config: AppConfig = {
    rootDir: PROJECT_ROOT,
    port: readInt('PORT', 8787, 1, 65_535),
    host: process.env.HOST?.trim() || '127.0.0.1',
    nodeEnv,
    logLevel: process.env.LOG_LEVEL?.trim() || (nodeEnv === 'test' ? 'silent' : 'info'),
    signingSecret: secretFromEnv || generatedSecret,
    signingSecretGenerated: !secretFromEnv,
    ytdlpPath: readPath('YTDLP_PATH', defaultYtdlp),
    ffmpegPath: readPath('FFMPEG_PATH', defaultFfmpeg),
    cookiesFile: process.env.COOKIES_FILE?.trim() ? readPath('COOKIES_FILE', '') : null,
    proxyUrl: process.env.PROXY_URL?.trim() || null,
    allowedHosts: readList('ALLOWED_HOSTS', DEFAULT_ALLOWED_HOSTS),
    tempDir,
    distDir,
    serveStatic:
      process.env.SERVE_STATIC !== 'false' && existsSync(join(distDir, 'index.html')),
    trustProxy: process.env.TRUST_PROXY === 'true',
    maxDurationSeconds: readInt('MAX_DURATION_SECONDS', 1800, 1, 86_400),
    maxFilesizeMb: readInt('MAX_FILESIZE_MB', 500, 1, 20_000),
    maxConcurrentJobs: readInt('MAX_CONCURRENT_JOBS', 2, 1, 16),
    maxQueuedJobs: readInt('MAX_QUEUED_JOBS', 20, 1, 500),
    jobTtlMs: readInt('JOB_TTL_MINUTES', 30, 1, 1440) * 60_000,
    tokenTtlMs: 15 * 60_000,
    resolveTimeoutMs: readInt('RESOLVE_TIMEOUT_SECONDS', 45, 5, 300) * 1000,
    downloadTimeoutMs: readInt('DOWNLOAD_TIMEOUT_SECONDS', 600, 30, 3600) * 1000,
    rateLimitResolve: readInt('RATE_LIMIT_RESOLVE_PER_MIN', 10, 1, 1000),
    rateLimitJobs: readInt('RATE_LIMIT_JOBS_PER_MIN', 5, 1, 1000),
  }

  return { ...config, ...overrides }
}
