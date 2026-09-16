/**
 * In-memory sliding-window rate limiter.
 * Ported from VeriLock `server/src/rate-limit.ts` (P1-02).
 * Response envelope matches Steakout API.md (`RATE_LIMITED` + retryAfterSeconds).
 */

import type { NextFunction, Request, Response } from 'express'

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

function defaultClientKey(req: Request): string {
  // Express only considers forwarded headers when `trust proxy` is enabled.
  // Reading x-forwarded-for directly lets a caller rotate the rate-limit key
  // by sending a spoofed header. Deployments behind a trusted proxy can set
  // Express's trust policy explicitly and `req.ip` will then be proxy-aware.
  return `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`
}

export interface RateLimitOptions {
  /** Extra key segment (e.g. address). Defaults to client IP. */
  keyFn?: (req: Request) => string
  /** Override path segment of the bucket key (defaults to req.path). */
  scope?: string
}

/**
 * Fixed-window rate limiter middleware.
 * @param max Maximum requests per window
 * @param windowMs Window length in milliseconds
 */
export function rateLimit(max: number, windowMs: number, options: RateLimitOptions = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const client = options.keyFn ? options.keyFn(req) : defaultClientKey(req)
    const scope = options.scope ?? req.path
    const key = `${scope}:${client}`
    const now = Date.now()
    const bucket = buckets.get(key)

    if (!bucket || now >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      next()
      return
    }

    if (bucket.count >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      res.setHeader('Retry-After', String(retryAfterSeconds))
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests — slow down and retry shortly.',
          retryAfterSeconds,
        },
      })
      return
    }

    bucket.count += 1
    next()
  }
}

/** Test helper: clear all rate-limit buckets. */
export function clearRateLimitBuckets(): void {
  buckets.clear()
}
