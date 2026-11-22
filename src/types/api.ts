export interface VideoInfo {
  platform: string
  platformLabel: string
  id: string
  title: string
  uploader?: string
  duration?: number
  thumbnail?: string
  webpageUrl: string
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

export interface ResolveResponse {
  video: VideoInfo
  presets: Preset[]
  token: string
  expiresAt: string
}

export type JobStatus =
  | 'queued'
  | 'downloading'
  | 'processing'
  | 'ready'
  | 'error'
  | 'canceled'

export interface JobError {
  code: string
  message: string
  hint?: string
}

export interface Job {
  id: string
  status: JobStatus
  stage: string
  progress: number
  title: string
  expiresAt: string
  filename?: string
  sizeBytes?: number
  error?: JobError
  fileUrl?: string
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    hint?: string
  }
}

export interface UiError {
  code: string
  message: string
  hint?: string
}
