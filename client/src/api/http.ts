/**
 * Cookie-session fetch helpers for the Steakout API.
 * Always uses credentials: 'include' so the httpOnly session cookie is sent.
 */

export class ApiError extends Error {
  readonly code: string
  readonly httpStatus: number
  readonly retryAfterSeconds?: number

  constructor(
    code: string,
    message: string,
    httpStatus: number,
    retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.httpStatus = httpStatus
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export interface ErrorEnvelope {
  error: {
    code: string
    message: string
    retryAfterSeconds?: number
  }
}

function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  if (!body || typeof body !== 'object') return false
  const err = (body as ErrorEnvelope).error
  return (
    err != null &&
    typeof err === 'object' &&
    typeof err.code === 'string' &&
    typeof err.message === 'string'
  )
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json')
  }

  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers,
  })

  let body: unknown = null
  const text = await response.text()
  if (text) {
    try {
      body = JSON.parse(text) as unknown
    } catch {
      body = null
    }
  }

  if (!response.ok) {
    if (isErrorEnvelope(body)) {
      throw new ApiError(
        body.error.code,
        body.error.message,
        response.status,
        body.error.retryAfterSeconds,
      )
    }
    throw new ApiError(
      'VALIDATION',
      response.statusText || `Request failed (${response.status})`,
      response.status,
    )
  }

  return body as T
}

export function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: 'GET' })
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function apiDelete<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: 'DELETE' })
}
