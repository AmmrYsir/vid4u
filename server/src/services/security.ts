import { createHmac, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { PLATFORM_DEFS, type PlatformDef } from '../constants.js'
import { AppError } from './errors.js'

const MAX_URL_LENGTH = 2048
const TRACKING_PARAMS = [/^utm_/i, /^fbclid$/i, /^igsh(id)?$/i, /^mibextid$/i]
const YOUTUBE_TRACKING_PARAMS = [/^si$/i, /^feature$/i, /^pp$/i]

function hostMatches(hostname: string, allowedHost: string): boolean {
  return hostname === allowedHost || hostname.endsWith(`.${allowedHost}`)
}

export interface PlatformInfo {
  id: string
  label: string
}

export function platformForUrl(url: URL): PlatformInfo {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  const platform = PLATFORM_DEFS.find((candidate: PlatformDef) =>
    candidate.hosts.some((host) => hostMatches(hostname, host)),
  )
  return platform ? { id: platform.id, label: platform.label } : { id: 'video', label: 'Video' }
}

function stripTracking(url: URL): URL {
  const youtube = platformForUrl(url).id === 'youtube'
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((pattern) => pattern.test(key))) {
      url.searchParams.delete(key)
    } else if (youtube && YOUTUBE_TRACKING_PARAMS.some((pattern) => pattern.test(key))) {
      url.searchParams.delete(key)
    }
  }
  url.hash = ''
  return url
}

/**
 * Validates a user-supplied link before it ever reaches yt-dlp.
 * Rejects non-HTTP(S), credentials, odd ports, IP literals, local names and
 * any host that is not in the configured suffix allowlist.
 */
export function assertAllowedUrl(input: string, allowedHosts: string[]): URL {
  const value = input.trim()
  if (value.length < 8 || value.length > MAX_URL_LENGTH) {
    throw new AppError('invalid_url', 'That link is not a valid video URL.', 400, {
      hint: 'Paste the full link from the platform.',
    })
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AppError('invalid_url', 'That link is not a valid video URL.', 400, {
      hint: 'Make sure it starts with https://.',
    })
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('invalid_url', 'Only http and https links are supported.', 400)
  }
  if (url.username || url.password) {
    throw new AppError('invalid_url', 'Links with embedded credentials are not supported.', 400)
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new AppError('invalid_url', 'Links with custom ports are not supported.', 400)
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (
    !hostname ||
    isIP(hostname) !== 0 ||
    hostname.startsWith('[') ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home.arpa')
  ) {
    throw new AppError('invalid_url', 'That host is not allowed.', 400)
  }

  const allowed = allowedHosts.some((host) => hostMatches(hostname, host.toLowerCase()))
  if (!allowed) {
    throw new AppError('unsupported', 'That platform is not supported yet.', 422, {
      hint: 'Try a link from Facebook, Instagram, YouTube, TikTok, X, Vimeo, Reddit or another supported site.',
    })
  }

  return stripTracking(url)
}

export interface DownloadTokenPayload {
  u: string
  t: string
  i: string
  e: number
}

const TOKEN_ERROR = new AppError(
  'invalid_token',
  'This download link expired or is invalid.',
  400,
  { hint: 'Find the video again to refresh the download.' },
)

function sign(payloadPart: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadPart).digest('base64url')
}

export function signDownloadToken(
  data: { url: string; title: string; mediaId: string },
  secret: string,
  ttlMs: number,
): { token: string; expiresAt: Date } {
  const payload: DownloadTokenPayload = {
    u: data.url,
    t: data.title.slice(0, 300),
    i: data.mediaId.slice(0, 200),
    e: Date.now() + ttlMs,
  }
  const payloadPart = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return {
    token: `${payloadPart}.${sign(payloadPart, secret)}`,
    expiresAt: new Date(payload.e),
  }
}

export function verifyDownloadToken(token: string, secret: string): DownloadTokenPayload {
  if (typeof token !== 'string' || token.length < 10 || token.length > 4096) {
    throw TOKEN_ERROR
  }
  const separator = token.lastIndexOf('.')
  if (separator <= 0) throw TOKEN_ERROR

  const payloadPart = token.slice(0, separator)
  const signaturePart = token.slice(separator + 1)
  const expected = Buffer.from(sign(payloadPart, secret), 'base64url')
  let given: Buffer
  try {
    given = Buffer.from(signaturePart, 'base64url')
  } catch {
    throw TOKEN_ERROR
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw TOKEN_ERROR
  }

  let payload: DownloadTokenPayload
  try {
    payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as DownloadTokenPayload
  } catch {
    throw TOKEN_ERROR
  }

  if (
    !payload ||
    typeof payload.u !== 'string' ||
    typeof payload.t !== 'string' ||
    typeof payload.i !== 'string' ||
    typeof payload.e !== 'number' ||
    payload.e <= Date.now()
  ) {
    throw TOKEN_ERROR
  }

  return payload
}

export function safeFilename(title: string, mediaId: string, extension: string): string {
  const ext = extension.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp4'
  const stem = `${title} [${mediaId}]`
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 120)
    .trim()
  const base = stem || 'video'
  return `${/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base) ? `_${base}` : base}.${ext}`
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
