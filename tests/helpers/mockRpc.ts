import { loadFixture } from './fixtures.js'

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  result?: unknown
  error?: unknown
  id: number | string | null
  [key: string]: unknown
}

export type FixtureSource = string | JsonRpcResponse

export type RpcErrorInjection =
  | Error
  | string
  | { message?: string; times?: number }

export type RpcTimeoutInjection = boolean | number | { message?: string; times?: number }

export interface MockRpcConfig {
  fixtures: Record<string, FixtureSource>
  errors?: Record<string, RpcErrorInjection | RpcErrorInjection[]>
  timeouts?: Record<string, RpcTimeoutInjection | RpcTimeoutInjection[]>
}

export interface RpcCall {
  method: string
  params: unknown[]
  url: string
}

export interface MockRpcResponse {
  ok: true
  status: 200
  headers: Headers
  json(): Promise<JsonRpcResponse>
  text(): Promise<string>
}

export interface MockRpc {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<MockRpcResponse>
  getCallCount(method: string): number
  getCalls(method: string): readonly RpcCall[]
  reset(): void
}

interface Injection {
  kind: 'error' | 'timeout'
  message?: string
  error?: Error
  remaining: number
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function parseErrorInjection(value: RpcErrorInjection): Injection {
  if (value instanceof Error) return { kind: 'error', error: value, remaining: 1 }
  if (typeof value === 'string') return { kind: 'error', message: value, remaining: 1 }
  return { kind: 'error', message: value.message, remaining: value.times ?? 1 }
}

function parseTimeoutInjection(value: RpcTimeoutInjection): Injection {
  if (typeof value === 'number') return { kind: 'timeout', remaining: value }
  if (typeof value === 'boolean') return { kind: 'timeout', remaining: value ? 1 : 0 }
  return { kind: 'timeout', message: value.message, remaining: value.times ?? 1 }
}

function parseRequest(input: string | URL | Request, init: RequestInit | undefined): { method: string; params: unknown[]; url: string } {
  const body = init?.body
  if (typeof body !== 'string') throw new Error('Mock RPC request body must be a JSON string')

  let payload: unknown
  try {
    payload = JSON.parse(body) as unknown
  } catch {
    throw new Error('Mock RPC request body is not valid JSON')
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Mock RPC request must be an object')
  }

  const request = payload as { method?: unknown; params?: unknown }
  if (typeof request.method !== 'string' || request.method === '') {
    throw new Error('Mock RPC request method is missing')
  }
  if (request.params !== undefined && !Array.isArray(request.params)) {
    throw new Error('Mock RPC request params must be an array')
  }

  return {
    method: request.method,
    params: request.params ?? [],
    url: typeof input === 'string' ? input : input.toString(),
  }
}

function consume(injections: Injection[] | undefined): Injection | undefined {
  const injection = injections?.[0]
  if (!injection || injection.remaining <= 0) return undefined
  injection.remaining -= 1
  if (injection.remaining === 0) injections?.shift()
  return injection
}

function injectionError(injection: Injection): Error {
  if (injection.error) return injection.error
  const error = new Error(injection.message ?? 'Injected RPC error')
  if (injection.kind === 'timeout') error.name = 'AbortError'
  return error
}

export function createMockRpc(config: MockRpcConfig): MockRpc {
  const calls = new Map<string, RpcCall[]>()
  const errors = new Map<string, Injection[]>()
  const timeouts = new Map<string, Injection[]>()

  for (const [method, value] of Object.entries(config.errors ?? {})) {
    errors.set(method, (Array.isArray(value) ? value : [value]).map(parseErrorInjection))
  }
  for (const [method, value] of Object.entries(config.timeouts ?? {})) {
    timeouts.set(method, (Array.isArray(value) ? value : [value]).map(parseTimeoutInjection))
  }

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<MockRpcResponse> => {
    const request = parseRequest(input, init)
    const methodCalls = calls.get(request.method) ?? []
    methodCalls.push(request)
    calls.set(request.method, methodCalls)

    const injected = consume(timeouts.get(request.method)) ?? consume(errors.get(request.method))
    if (injected) throw injectionError(injected)

    const fixture = config.fixtures[request.method]
    if (fixture === undefined) throw new Error(`No RPC fixture mapped for ${request.method}`)
    const payload = typeof fixture === 'string' ? loadFixture<JsonRpcResponse>(fixture) : fixture
    const responseBody = JSON.stringify(clone(payload))
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => JSON.parse(responseBody) as JsonRpcResponse,
      text: async () => responseBody,
    }
  }

  return {
    fetch,
    getCallCount: (method) => calls.get(method)?.length ?? 0,
    getCalls: (method) => calls.get(method)?.slice() ?? [],
    reset: () => calls.clear(),
  }
}
