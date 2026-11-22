import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import type { JobManager } from './services/jobs.js'
import { signDownloadToken } from './services/security.js'
import type { YtInfo } from './services/presets.js'
import type { YtDlp } from './services/ytdlp.js'

const info: YtInfo = {
  id: '123',
  title: 'Test reel',
  uploader: 'Tester',
  duration: 24,
  webpage_url: 'https://www.facebook.com/reel/123',
  formats: [
    { format_id: '720', height: 720, vcodec: 'avc1', acodec: 'none', ext: 'mp4', filesize: 2_000_000 },
    { format_id: 'audio', vcodec: 'none', acodec: 'mp4a', ext: 'm4a', abr: 128, filesize: 300_000 },
  ],
}

const ytdlp = {
  resolve: async () => info,
  version: async () => '2026.10.26',
  download: async () => {
    throw new Error('not used in this test')
  },
} as unknown as YtDlp

const jobs = {
  create: async (input: { title: string }) => ({
    id: 'j_test',
    status: 'queued',
    stage: 'Waiting in queue',
    progress: 0,
    title: input.title,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }),
  get: () => null,
  getFile: () => {
    throw new Error('not ready')
  },
  cancel: async () => true,
  shutdown: async () => {},
} as unknown as JobManager

const config = loadConfig({
  nodeEnv: 'test',
  serveStatic: false,
  signingSecret: 'test-secret',
  ytdlpPath: 'unused',
  ffmpegPath: 'unused',
})

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp({ config, ytdlp, jobs })
})

afterAll(async () => {
  await app.close()
})

async function resolveToken(): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/resolve',
    payload: { url: 'https://www.facebook.com/reel/123' },
  })
  expect(response.statusCode).toBe(200)
  return response.json().token as string
}

describe('API', () => {
  it('resolves a supported link into metadata and presets', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/resolve',
      payload: { url: 'https://www.facebook.com/reel/123' },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.video).toMatchObject({
      platform: 'facebook',
      platformLabel: 'Facebook',
      title: 'Test reel',
      uploader: 'Tester',
      duration: 24,
    })
    expect(body.presets.map((preset: { id: string }) => preset.id)).toEqual([
      'video:best',
      'video:720',
      'audio:mp3',
    ])
    expect(typeof body.token).toBe('string')
  })

  it('returns the public error envelope for an unsupported host', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/resolve',
      payload: { url: 'https://example.com/video' },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({
      error: { code: 'unsupported' },
    })
  })

  it('rejects an empty resolve body', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/resolve', payload: {} })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('invalid_url')
  })

  it('creates a job from a signed token', async () => {
    const token = await resolveToken()
    const response = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      payload: { token, presetId: 'video:720' },
    })
    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({ id: 'j_test', status: 'queued' })
  })

  it('rejects a tampered or expired token', async () => {
    const token = await resolveToken()
    const tampered = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      payload: { token: `${token}x`, presetId: 'video:720' },
    })
    expect(tampered.statusCode).toBe(400)
    expect(tampered.json().error.code).toBe('invalid_token')

    const expired = signDownloadToken(
      { url: info.webpage_url as string, title: info.title as string, mediaId: '123' },
      config.signingSecret,
      -1000,
    )
    const expiredResponse = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      payload: { token: expired.token, presetId: 'video:720' },
    })
    expect(expiredResponse.statusCode).toBe(400)
    expect(expiredResponse.json().error.code).toBe('invalid_token')
  })

  it('rejects an invalid preset', async () => {
    const token = await resolveToken()
    const response = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      payload: { token, presetId: 'video:9999' },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('format_unavailable')
  })

  it('returns 404 for an unknown job', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/jobs/j_missing' })
    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe('not_found')
  })

  it('accepts a cancel request without a JSON body', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/api/jobs/j_test' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
  })

  it('keeps malformed Fastify requests as 4xx errors', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/resolve',
      headers: { 'content-type': 'application/json' },
      payload: '',
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('invalid_request')
  })

  it('reports health without leaking internals', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toHaveProperty('ytdlp.available')
    expect(response.json()).not.toHaveProperty('signingSecret')
  })
})

describe('static hosting', () => {
  let staticApp: FastifyInstance
  let directory: string

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'vid4u-static-'))
    await writeFile(join(directory, 'index.html'), '<!doctype html><h1>SPA</h1>', 'utf8')
    staticApp = await buildApp({
      config: loadConfig({
        ...config,
        serveStatic: true,
        distDir: directory,
      }),
      ytdlp,
      jobs,
    })
  })

  afterAll(async () => {
    await staticApp.close()
    await rm(directory, { recursive: true, force: true })
  })

  it('keeps API errors in the JSON envelope with the static plugin registered', async () => {
    const response = await staticApp.inject({
      method: 'POST',
      url: '/api/resolve',
      payload: { url: 'https://example.com/video' },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: { code: 'unsupported' } })
  })

  it('serves the SPA for non-API routes', async () => {
    const response = await staticApp.inject({ method: 'GET', url: '/some/app/route' })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('SPA')
  })
})
