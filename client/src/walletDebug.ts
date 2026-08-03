/**
 * Lightweight wallet debug logging.
 * Adapted from VeriLock client debug helpers (P1-01).
 */

const PREFIX = '[steakout:wallet]'

function formatDetail(detail: unknown): unknown {
  if (detail instanceof Error) {
    return { name: detail.name, message: detail.message, stack: detail.stack }
  }
  return detail
}

export function walletLog(phase: string, detail?: unknown): void {
  if (detail === undefined) {
    console.log(PREFIX, phase)
    return
  }
  console.log(PREFIX, phase, formatDetail(detail))
}

export function walletWarn(phase: string, detail?: unknown): void {
  if (detail === undefined) {
    console.warn(PREFIX, phase)
    return
  }
  console.warn(PREFIX, phase, formatDetail(detail))
}

export function walletError(phase: string, err: unknown): void {
  console.error(PREFIX, phase, formatDetail(err))
}
