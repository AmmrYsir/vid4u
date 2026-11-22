/**
 * Real-link smoke test against a running vid4u API.
 *
 *   pnpm start                 # production build + API on :8787
 *   pnpm smoke -- https://www.facebook.com/reel/...
 *
 * Optional env:
 *   SMOKE_BASE_URL=http://127.0.0.1:8787
 *   SMOKE_PRESET=video:720
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface Health {
  ok: boolean
  ytdlp: { available: boolean; version: string | null }
  ffmpeg: { available: boolean; version: string | null }
}

interface Resolved {
  video: { title: string; platformLabel: string; duration?: number }
  presets: Array<{ id: string; label: string }>
  token: string
}

interface Job {
  id: string
  status: 'queued' | 'downloading' | 'processing' | 'ready' | 'error' | 'canceled'
  stage: string
  progress: number
  filename?: string
  sizeBytes?: number
  fileUrl?: string
  error?: { code: string; message: string; hint?: string }
}

const base = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '')
const url = process.argv.slice(2).find((argument) => argument !== '--')
const presetId = process.env.SMOKE_PRESET || 'video:best'

if (!url) {
  console.error('Usage: pnpm smoke -- <public video URL>')
  process.exit(1)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    })
  } catch (error) {
    throw new Error(
      `Could not reach ${base}. Start the API first with "pnpm start" or "pnpm dev:api". (${String(error)})`,
    )
  }
  const body = (await response.json().catch(() => null)) as
    | { error?: { message?: string; hint?: string } }
    | null
  if (!response.ok) {
    const message = body?.error?.message ?? response.statusText
    throw new Error(`${response.status} ${message}${body?.error?.hint ? ` — ${body.error.hint}` : ''}`)
  }
  return body as T
}

async function main(): Promise<void> {
  console.log(`API  ${base}`)
  const health = await api<Health>('/api/health')
  console.log(
    `Tools yt-dlp=${health.ytdlp.version ?? 'missing'} ffmpeg=${health.ffmpeg.available ? 'ok' : 'missing'}`,
  )
  if (!health.ok) throw new Error('The server is missing yt-dlp or FFmpeg. Run "pnpm setup:tools".')

  console.log(`Resolve ${url}`)
  const resolved = await api<Resolved>('/api/resolve', {
    method: 'POST',
    body: JSON.stringify({ url }),
  })
  console.log(
    `Video   ${resolved.video.title} (${resolved.video.platformLabel}${resolved.video.duration ? `, ${resolved.video.duration}s` : ''})`,
  )
  console.log(`Presets ${resolved.presets.map((preset) => `${preset.id} (${preset.label})`).join(', ')}`)

  if (!resolved.presets.some((preset) => preset.id === presetId)) {
    throw new Error(`Preset ${presetId} is not available for this video.`)
  }

  console.log(`Job     preset=${presetId}`)
  const created = await api<Job>('/api/jobs', {
    method: 'POST',
    body: JSON.stringify({ token: resolved.token, presetId }),
  })
  let job = created

  for (let attempt = 0; attempt < 300; attempt += 1) {
    await sleep(1000)
    job = await api<Job>(`/api/jobs/${job.id}`)
    process.stdout.write(
      `\r        ${job.status.padEnd(11)} ${String(job.progress).padStart(3)}%  ${job.stage}`,
    )
    if (job.status === 'ready' || job.status === 'error' || job.status === 'canceled') break
  }
  process.stdout.write('\n')

  if (job.status !== 'ready' || !job.fileUrl) {
    throw new Error(job.error ? `${job.error.code}: ${job.error.message}` : `Job ended as ${job.status}`)
  }

  const response = await fetch(`${base}${job.fileUrl}`)
  if (!response.ok) throw new Error(`File download failed: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const outputDir = join(process.cwd(), '.tmp')
  await mkdir(outputDir, { recursive: true })
  const output = join(outputDir, `smoke-${job.id}.${job.filename?.split('.').pop() ?? 'mp4'}`)
  await writeFile(output, bytes)

  console.log(
    `Saved   ${output} (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB, ${job.filename})`,
  )
}

main().catch((error) => {
  console.error(`\nSmoke test failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
