import type { ApiErrorBody, Job, ResolveResponse } from '../types/api'

export class ApiError extends Error {
  readonly code: string
  readonly hint?: string
  readonly status?: number

  constructor(code: string, message: string, hint?: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.hint = hint
    this.status = status
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    })
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new ApiError(
      'network',
      'Could not reach the vid4u server.',
      'Make sure the API is running, then try again.',
    )
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const apiError = (body as ApiErrorBody | null)?.error
    throw new ApiError(
      apiError?.code ?? 'http_error',
      apiError?.message ?? 'Something went wrong.',
      apiError?.hint,
      response.status,
    )
  }

  return body as T
}

export function resolveVideo(url: string, signal?: AbortSignal): Promise<ResolveResponse> {
  return request<ResolveResponse>('/api/resolve', {
    method: 'POST',
    body: JSON.stringify({ url }),
    signal,
  })
}

export function createJob(token: string, presetId: string): Promise<Job> {
  return request<Job>('/api/jobs', {
    method: 'POST',
    body: JSON.stringify({ token, presetId }),
  })
}

export function getJob(id: string, signal?: AbortSignal): Promise<Job> {
  return request<Job>(`/api/jobs/${encodeURIComponent(id)}`, { signal })
}

export function cancelJob(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/jobs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
