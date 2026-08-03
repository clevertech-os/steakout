import { readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'

export const FIXTURE_ROOT = resolve(process.cwd(), 'tests/fixtures')

export interface FixtureCapture {
  file: string
  method: string
  params: unknown[]
  httpStatus: number
  outcome: string
  [key: string]: unknown
}

export interface FixtureMeta {
  capture: string
  endpoint: string
  network: string
  capturedAt: string
  captures: FixtureCapture[]
  [key: string]: unknown
}

export interface LoadedFixture<T> {
  data: T
  meta: FixtureMeta
  fixturePath: string
  metadataPath: string
  capture: FixtureCapture
}

export interface FixtureLoadOptions {
  rootDir?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to read JSON fixture ${path}: ${message}`)
  }
}

function assertInsideRoot(path: string, rootDir: string, label: string): void {
  const pathFromRoot = relative(rootDir, path)
  if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
    throw new Error(`${label} must be inside fixture root ${rootDir}`)
  }
}

function assertFixtureCapture(value: unknown, index: number): FixtureCapture {
  if (!isRecord(value)) throw new Error(`Fixture metadata capture ${index} must be an object`)

  const requiredStrings = ['file', 'method', 'outcome']
  for (const key of requiredStrings) {
    if (typeof value[key] !== 'string' || value[key] === '') {
      throw new Error(`Fixture metadata capture ${index}.${key} must be a non-empty string`)
    }
  }
  if (!Array.isArray(value.params)) {
    throw new Error(`Fixture metadata capture ${index}.params must be an array`)
  }
  if (typeof value.httpStatus !== 'number' || !Number.isInteger(value.httpStatus)) {
    throw new Error(`Fixture metadata capture ${index}.httpStatus must be an integer`)
  }

  return value as FixtureCapture
}

export function validateFixtureMetadata(value: unknown, metadataPath = '_meta.json'): FixtureMeta {
  if (!isRecord(value)) throw new Error(`Fixture metadata ${metadataPath} must be an object`)

  for (const key of ['capture', 'endpoint', 'network', 'capturedAt']) {
    if (typeof value[key] !== 'string' || value[key] === '') {
      throw new Error(`Fixture metadata ${metadataPath}.${key} must be a non-empty string`)
    }
  }
  if (Number.isNaN(Date.parse(value.capturedAt as string))) {
    throw new Error(`Fixture metadata ${metadataPath}.capturedAt must be an ISO date`)
  }
  try {
    new URL(value.endpoint as string)
  } catch {
    throw new Error(`Fixture metadata ${metadataPath}.endpoint must be a URL`)
  }
  if (!Array.isArray(value.captures)) {
    throw new Error(`Fixture metadata ${metadataPath}.captures must be an array`)
  }

  const captures = value.captures.map(assertFixtureCapture)
  const files = new Set<string>()
  for (const capture of captures) {
    if (files.has(capture.file)) throw new Error(`Fixture metadata ${metadataPath} contains duplicate file ${capture.file}`)
    files.add(capture.file)
  }

  return { ...value, captures } as FixtureMeta
}

function metadataPathForFixture(fixturePath: string, rootDir: string): string {
  let directory = dirname(fixturePath)
  while (true) {
    const candidate = resolve(directory, '_meta.json')
    try {
      readFileSync(candidate)
      return candidate
    } catch {
      if (directory === rootDir) break
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }
  throw new Error(`No _meta.json found for fixture ${fixturePath}`)
}

export function loadFixtureWithMeta<T>(fixtureName: string, options: FixtureLoadOptions = {}): LoadedFixture<T> {
  const rootDir = resolve(options.rootDir ?? FIXTURE_ROOT)
  const fixturePath = resolve(rootDir, fixtureName)
  assertInsideRoot(fixturePath, rootDir, 'Fixture path')

  const metadataPath = metadataPathForFixture(fixturePath, rootDir)
  const meta = validateFixtureMetadata(readJson(metadataPath), metadataPath)
  const relativeFixturePath = relative(dirname(metadataPath), fixturePath)
  const capture = meta.captures.find(
    (entry) => entry.file === relativeFixturePath || entry.file === basename(fixturePath),
  )
  if (!capture) {
    throw new Error(`Fixture ${fixtureName} is not listed in ${metadataPath}`)
  }

  return {
    data: readJson(fixturePath) as T,
    meta,
    fixturePath,
    metadataPath,
    capture,
  }
}

export function loadFixture<T = unknown>(fixtureName: string, options: FixtureLoadOptions = {}): T {
  return loadFixtureWithMeta<T>(fixtureName, options).data
}
