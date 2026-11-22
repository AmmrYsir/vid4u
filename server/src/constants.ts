export interface PlatformDef {
  id: string
  label: string
  hosts: string[]
}

/**
 * Hostnames are matched against the URL hostname and every parent suffix, so
 * "facebook.com" also covers "www.facebook.com" and "m.facebook.com".
 */
export const PLATFORM_DEFS: PlatformDef[] = [
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
]

export const DEFAULT_ALLOWED_HOSTS = [...new Set(PLATFORM_DEFS.flatMap((platform) => platform.hosts))]
