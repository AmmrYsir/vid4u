const PLATFORMS = [
  { id: 'facebook', label: 'Facebook', hosts: ['facebook.com', 'fb.com', 'fb.watch'] },
  { id: 'instagram', label: 'Instagram', hosts: ['instagram.com'] },
  { id: 'youtube', label: 'YouTube', hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'] },
  { id: 'tiktok', label: 'TikTok', hosts: ['tiktok.com'] },
  { id: 'x', label: 'X', hosts: ['x.com', 'twitter.com'] },
  { id: 'vimeo', label: 'Vimeo', hosts: ['vimeo.com'] },
  { id: 'reddit', label: 'Reddit', hosts: ['reddit.com', 'redd.it'] },
  { id: 'dailymotion', label: 'Dailymotion', hosts: ['dailymotion.com', 'dai.ly'] },
  { id: 'twitch', label: 'Twitch', hosts: ['twitch.tv'] },
  { id: 'pinterest', label: 'Pinterest', hosts: ['pinterest.com', 'pin.it'] },
  { id: 'threads', label: 'Threads', hosts: ['threads.net'] },
  { id: 'linkedin', label: 'LinkedIn', hosts: ['linkedin.com'] },
] as const

export interface DetectedPlatform {
  id: string
  label: string
}

function hostMatches(hostname: string, allowedHost: string): boolean {
  return hostname === allowedHost || hostname.endsWith(`.${allowedHost}`)
}

export function detectPlatform(input: string): DetectedPlatform | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  const platform = PLATFORMS.find((candidate) =>
    candidate.hosts.some((host) => hostMatches(hostname, host)),
  )
  return platform ? { id: platform.id, label: platform.label } : null
}

export function formatDuration(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return ''
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remaining = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
  }
  return `${minutes}:${String(remaining).padStart(2, '0')}`
}

export function formatBytes(bytes: number | undefined): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return ''
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  if (mb >= 10) return `${Math.round(mb)} MB`
  return `${mb.toFixed(1)} MB`
}

export function minutesUntil(isoDate: string | undefined): number {
  if (!isoDate) return 0
  const time = new Date(isoDate).getTime()
  if (!Number.isFinite(time)) return 0
  return Math.max(0, Math.ceil((time - Date.now()) / 60_000))
}
