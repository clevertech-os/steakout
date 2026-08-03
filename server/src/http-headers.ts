/**
 * Security headers for API + SPA.
 * Ported from VeriLock `server/src/http-headers.ts` (P1-02).
 *
 * API uses helmet defaults (minus CSP/COOP/CORP/frameguard that break Hub popups).
 * SPA gets minimal nosniff + referrer policy so Nimiq Hub redirect RPC still works.
 */

import type { Express, RequestHandler } from 'express'
import helmet from 'helmet'

/**
 * Security headers for JSON API responses only.
 * The SPA is served separately — see spaSecurityHeaders.
 */
const apiSecurityHeaders: RequestHandler = helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  frameguard: false,
})

/**
 * Minimal headers for the React SPA.
 * Avoid COOP/CORP/strict CSP here — they break Nimiq Hub popup postMessage.
 * Referrer must be sent on cross-origin navigations to hub.nimiq.com; Nimiq's
 * redirect RPC rejects requests when document.referrer is empty (request-error).
 */
const spaSecurityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
}

export function applySecurityHeaders(app: Express): void {
  app.use('/api', apiSecurityHeaders)
  app.use(spaSecurityHeaders)
  app.disable('x-powered-by')
}
