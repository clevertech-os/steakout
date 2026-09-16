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
 * Referrer must be sent on cross-origin navigations to hub.nimiq.com /
 * hub.nimiq-testnet.com; Nimiq's redirect RPC rejects requests when
 * document.referrer is empty (request-error).
 */
const spaSecurityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  // Keep the SPA executable only from its own build while allowing the two
  // Nimiq Hub hosts used by wallet sign-in and the public RPC/registry hosts
  // used by the read-only fallback paths. Hub popups still work because this
  // policy governs the SPA document, not the separately navigated Hub page.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://hub.nimiq.com https://hub.nimiq-testnet.com https://rpc.nimiqwatch.com https://rpc.testnet.nimiqwatch.com https://validators-api-main.je-cf9.workers.dev https://validators-api-test.je-cf9.workers.dev https://faucet.pos.nimiq-testnet.com https://api.qrserver.com",
      "frame-src 'self' https://hub.nimiq.com https://hub.nimiq-testnet.com",
      "form-action 'self' https://hub.nimiq.com https://hub.nimiq-testnet.com",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; '),
  )
  next()
}

export function applySecurityHeaders(app: Express): void {
  app.use('/api', apiSecurityHeaders)
  app.use(spaSecurityHeaders)
  app.disable('x-powered-by')
}
