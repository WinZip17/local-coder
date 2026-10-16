import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici'
import { socksDispatcher } from 'fetch-socks'
import type { Settings } from '../shared/types'

function isLocalHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  } catch {
    return false
  }
}

const direct = new Agent({
  allowH2: false,
  connectTimeout: 30_000,
  headersTimeout: 180_000,
  bodyTimeout: 600_000
})

export function describeNetworkError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error(String(error))
  const cause = error.cause
  if (!(cause instanceof Error) || !cause.message || error.message.includes(cause.message)) return error
  const code = 'code' in cause && typeof cause.code === 'string' ? `${cause.code}: ` : ''
  return new Error(`${error.message}: ${code}${cause.message}`)
}

export function dispatcherFor(url: string, settings: Settings): Dispatcher | undefined {
  const proxy = settings.proxy
  if (!proxy.enabled || !proxy.host || isLocalHost(url)) return undefined
  const auth = proxy.username ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@` : ''
  if (proxy.protocol === 'socks5') {
    return socksDispatcher({
      type: 5,
      host: proxy.host,
      port: proxy.port,
      userId: proxy.username || undefined,
      password: proxy.password || undefined
    })
  }
  return new ProxyAgent(`${proxy.protocol}://${auth}${proxy.host}:${proxy.port}`)
}

export async function appFetch(url: string, settings: Settings, init: {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
} = {}): Promise<Response> {
  const dispatcher = dispatcherFor(url, settings) ?? direct
  try {
    return await undiciFetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: init.signal,
      dispatcher
    }) as unknown as Promise<Response>
  } catch (error) {
    throw describeNetworkError(error)
  }
}

export async function readError(response: Response): Promise<string> {
  const text = await response.text()
  return `HTTP ${response.status}: ${text.slice(0, 500)}`
}
