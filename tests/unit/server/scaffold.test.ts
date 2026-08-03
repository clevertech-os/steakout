import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../../server/src/db.js'

describe('server scaffold', () => {
  it('opens SQLite with WAL and foreign keys enabled', () => {
    const directory = mkdtempSync(join(tmpdir(), 'steakout-'))
    const database = openDatabase(join(directory, 'test.sqlite'))

    expect(database.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1)

    database.close()
    rmSync(directory, { recursive: true, force: true })
  })
})
