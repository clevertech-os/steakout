/**
 * Window globals injected by Nimiq Pay host / mini-app SDK.
 * Ported from VeriLock `client/src/nimiq-globals.d.ts` (P1-01).
 */

import type { NimiqProvider } from '@nimiq/mini-app-sdk'

interface NimiqPayHostContext {
  language?: string
  requestDeviceIdentifier?: (options: { reason: string }) => Promise<string>
}

declare global {
  interface Window {
    nimiq?: NimiqProvider
    nimiqPay?: NimiqPayHostContext
  }
}

export {}
