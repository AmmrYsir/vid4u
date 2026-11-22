import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AppConfig } from '../config.js'
import type { YtDlp } from './ytdlp.js'

const execFileAsync = promisify(execFile)

export interface ToolStatus {
  available: boolean
  version: string | null
  path: string
}

export interface HealthStatus {
  ok: boolean
  ytdlp: ToolStatus
  ffmpeg: ToolStatus
  uptimeSeconds: number
}

interface CachedHealth {
  status: HealthStatus
  checkedAt: number
}

export class ToolChecker {
  private cached: CachedHealth | null = null
  private readonly startedAt = Date.now()

  constructor(
    private readonly config: AppConfig,
    private readonly ytdlp: YtDlp,
  ) {}

  async check(force = false): Promise<HealthStatus> {
    if (!force && this.cached && Date.now() - this.cached.checkedAt < 60_000) {
      return this.cached.status
    }

    const [ytdlpVersion, ffmpegVersion] = await Promise.all([
      this.ytdlp.version(),
      this.ffmpegVersion(),
    ])

    const status: HealthStatus = {
      ok: Boolean(ytdlpVersion && ffmpegVersion),
      ytdlp: {
        available: Boolean(ytdlpVersion),
        version: ytdlpVersion,
        path: this.config.ytdlpPath,
      },
      ffmpeg: {
        available: Boolean(ffmpegVersion),
        version: ffmpegVersion,
        path: this.config.ffmpegPath,
      },
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
    }

    this.cached = { status, checkedAt: Date.now() }
    return status
  }

  private async ffmpegVersion(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(this.config.ffmpegPath, ['-version'], {
        timeout: 5000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      })
      return stdout.split(/\r?\n/)[0]?.trim() || null
    } catch {
      return null
    }
  }
}
