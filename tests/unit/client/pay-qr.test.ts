import { describe, expect, it } from 'vitest'
import { buildQrImageUrl } from '../../../client/src/nimiq.ts'

describe('buildQrImageUrl', () => {
  it('encodes payload and clamps size', () => {
    const url = buildQrImageUrl('http://192.168.1.87:5173/', 220)
    expect(url).toContain('api.qrserver.com')
    expect(url).toContain('size=220x220')
    expect(url).toContain(encodeURIComponent('http://192.168.1.87:5173/'))
  })
})
