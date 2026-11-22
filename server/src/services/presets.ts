import { AppError } from './errors.js'

export interface YtFormat {
  format_id?: string
  ext?: string
  height?: number | null
  width?: number | null
  vcodec?: string | null
  acodec?: string | null
  filesize?: number | null
  filesize_approx?: number | null
  tbr?: number | null
  abr?: number | null
  format_note?: string | null
}

export interface YtThumbnail {
  url?: string
  preference?: number | null
  width?: number | null
  height?: number | null
}

export interface YtInfo {
  id?: string
  title?: string
  uploader?: string
  channel?: string
  creator?: string
  duration?: number | null
  thumbnail?: string
  thumbnails?: YtThumbnail[]
  webpage_url?: string
  original_url?: string
  extractor_key?: string
  extractor?: string
  is_live?: boolean
  live_status?: string | null
  _type?: string
  entries?: unknown[]
  formats?: YtFormat[]
  url?: string
  ext?: string
}

export interface Preset {
  id: string
  label: string
  kind: 'video' | 'audio'
  height?: number
  width?: number
  ext: 'mp4' | 'mp3'
  sizeBytes?: number
}

const MAX_HEIGHT = 2160
const MAX_PRESETS = 6

function formatSize(format: YtFormat): number | undefined {
  const value = format.filesize ?? format.filesize_approx
  return typeof value === 'number' && value > 0 ? value : undefined
}

function hasVideo(format: YtFormat): boolean {
  return typeof format.vcodec === 'string' && format.vcodec !== 'none'
}

function hasAudio(format: YtFormat): boolean {
  return typeof format.acodec === 'string' && format.acodec !== 'none'
}

function bestAudioFormat(formats: YtFormat[]): YtFormat | undefined {
  return formats
    .filter((format) => hasAudio(format) && !hasVideo(format))
    .sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0))[0]
}

function bestVideoFormat(formats: YtFormat[], height: number): YtFormat | undefined {
  return formats
    .filter((format) => hasVideo(format) && format.height === height)
    .sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0))[0]
}

function estimateVideoSize(formats: YtFormat[], height: number): number | undefined {
  const video = bestVideoFormat(formats, height)
  if (!video) return undefined
  const audio = bestAudioFormat(formats)
  const videoSize = formatSize(video)
  const audioSize = audio ? formatSize(audio) : undefined
  if (!videoSize) return undefined
  return videoSize + (audioSize ?? 0)
}

export function pickThumbnail(info: YtInfo): string | undefined {
  if (typeof info.thumbnail === 'string' && info.thumbnail) return info.thumbnail
  return [...(info.thumbnails ?? [])]
    .filter((thumbnail) => typeof thumbnail.url === 'string' && thumbnail.url)
    .sort(
      (a, b) =>
        (b.preference ?? 0) - (a.preference ?? 0) || (b.width ?? 0) - (a.width ?? 0),
    )[0]?.url
}

export function buildPresets(info: YtInfo): Preset[] {
  const formats = Array.isArray(info.formats) ? info.formats : []
  const heights = [...new Set(
    formats
      .filter((format) => hasVideo(format) && typeof format.height === 'number')
      .map((format) => format.height as number)
      .filter((height) => Number.isInteger(height) && height > 0 && height <= MAX_HEIGHT),
  )]
    .sort((a, b) => b - a)
    .slice(0, MAX_PRESETS)

  const presets: Preset[] = []

  if (heights.length === 0) {
    const directVideo =
      Boolean(info.url) && ['mp4', 'webm', 'mov', 'mkv'].includes((info.ext ?? '').toLowerCase())
    if (formats.some(hasVideo) || directVideo) {
      presets.push({ id: 'video:best', label: 'MP4 · Best available', kind: 'video', ext: 'mp4' })
    }
    // Facebook's extractor exposes progressive "hd"/"sd" formats without a
    // numeric height. Keep those choices instead of silently collapsing to best.
    const formatIds = new Set(formats.map((format) => format.format_id).filter(Boolean))
    if (formatIds.has('hd')) {
      presets.push({ id: 'video:hd', label: 'MP4 · HD', kind: 'video', ext: 'mp4' })
    }
    if (formatIds.has('sd')) {
      presets.push({ id: 'video:sd', label: 'MP4 · SD', kind: 'video', ext: 'mp4' })
    }
  } else {
    presets.push({ id: 'video:best', label: 'MP4 · Best available', kind: 'video', ext: 'mp4' })
    for (const height of heights) {
      const size = estimateVideoSize(formats, height)
      const format = bestVideoFormat(formats, height)
      const width = format?.width ?? undefined
      const portrait = Boolean(width && width < height)
      presets.push({
        id: `video:${height}`,
        label: portrait ? `MP4 · ${width}×${height}` : `MP4 · ${height}p`,
        kind: 'video',
        height,
        ...(width ? { width } : {}),
        ext: 'mp4',
        ...(size ? { sizeBytes: size } : {}),
      })
    }
  }

  if (formats.some(hasAudio) || formats.length > 0 || info.url) {
    presets.push({ id: 'audio:mp3', label: 'MP3 · Audio', kind: 'audio', ext: 'mp3' })
  }

  return presets
}

export interface PresetSelection {
  formatSelector: string
  audioOnly: boolean
  ext: 'mp4' | 'mp3'
}

export function resolvePreset(presetId: string): PresetSelection {
  if (presetId === 'audio:mp3') {
    return { formatSelector: 'ba/b', audioOnly: true, ext: 'mp3' }
  }
  if (presetId === 'video:best') {
    return {
      formatSelector:
        'bv*[vcodec^=avc1]+ba[ext=m4a]/bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
      audioOnly: false,
      ext: 'mp4',
    }
  }

  if (presetId === 'video:hd' || presetId === 'video:sd') {
    return {
      formatSelector: presetId === 'video:hd' ? 'hd/b' : 'sd/b',
      audioOnly: false,
      ext: 'mp4',
    }
  }

  const match = /^video:(\d{1,4})$/.exec(presetId)
  const height = match ? Number.parseInt(match[1], 10) : 0
  if (!match || height < 1 || height > 4320) {
    throw new AppError('format_unavailable', 'That quality is not available.', 422)
  }

  return {
    formatSelector: [
      `bv*[height<=${height}][vcodec^=avc1]+ba[ext=m4a]`,
      `bv*[height<=${height}][ext=mp4]+ba[ext=m4a]`,
      `b[height<=${height}][ext=mp4]`,
      `bv*[height<=${height}]+ba`,
      `b[height<=${height}]`,
    ].join('/'),
    audioOnly: false,
    ext: 'mp4',
  }
}
