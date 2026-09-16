import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../../../server/src/app.js'
import { openDatabase } from '../../../server/src/db.js'
import { clearRateLimitBuckets } from '../../../server/src/rate-limit.js'

const servers: Server[] = []
const databases: Array<ReturnType<typeof openDatabase>> = []
const directories: string[] = []

afterEach(async () => {
  clearRateLimitBuckets()
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  )
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

async function listen(isProduction: boolean): Promise<{ baseUrl: string }> {
  const directory = mkdtempSync(join(tmpdir(), 'steakout-security-'))
  directories.push(directory)
  const database = openDatabase(join(directory, 'test.sqlite'))
  databases.push(database)
  const server = createServer(createApp({ database, isProduction }))
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('expected TCP address')
  return { baseUrl: `http://127.0.0.1:${address.port}` }
}

describe('production security boundaries', () => {
  it('does not expose development spike APIs in production', async () => {
    delete process.env.CORS_ORIGIN
    const { baseUrl } = await listen(true)

    const response = await fetch(`${baseUrl}/api/spike/block-number`)
    expect(response.status).toBe(404)
  })

  it('does not reflect arbitrary origins when production CORS is unset', async () => {
    delete process.env.CORS_ORIGIN
    const { baseUrl } = await listen(true)

    const response = await fetch(`${baseUrl}/api/me`, {
      headers: { Origin: 'https://attacker.example' },
    })
    expect(response.status).toBe(401)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(response.headers.get('content-security-policy')).toContain('https://hub.nimiq.com')
  })

  it('does not allow spoofed forwarded headers to rotate rate-limit identity', async () => {
    delete process.env.CORS_ORIGIN
    const { baseUrl } = await listen(false)
    let lastStatus = 0
    for (let index = 0; index < 13; index += 1) {
      const response = await fetch(`${baseUrl}/api/auth/challenge`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': `198.51.100.${index + 1}`,
        },
        body: JSON.stringify({ address: 'not-an-address' }),
      })
      lastStatus = response.status
    }
    expect(lastStatus).toBe(429)
  })
})
