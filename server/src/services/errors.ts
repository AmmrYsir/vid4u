export type ErrorCode =
  | 'invalid_url'
  | 'invalid_request'
  | 'invalid_token'
  | 'unsupported'
  | 'playlist_unsupported'
  | 'login_required'
  | 'private'
  | 'live_unsupported'
  | 'too_long'
  | 'too_big'
  | 'no_formats'
  | 'format_unavailable'
  | 'rate_limited'
  | 'busy'
  | 'extractor_failed'
  | 'timeout'
  | 'tools_missing'
  | 'not_ready'
  | 'not_found'
  | 'internal'

export interface PublicErrorBody {
  error: {
    code: ErrorCode
    message: string
    hint?: string
  }
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly statusCode: number
  readonly hint?: string
  readonly detail?: string

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number,
    options: { hint?: string; detail?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCode
    this.hint = options.hint
    this.detail = options.detail
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError
}

export function toPublicErrorBody(error: AppError): PublicErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.hint ? { hint: error.hint } : {}),
    },
  }
}

export function internalError(detail?: string): AppError {
  return new AppError('internal', 'Something went wrong on our side.', 500, {
    hint: 'Please try again in a moment.',
    detail,
  })
}
