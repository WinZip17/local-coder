import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici'
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
  const dispatcher = dispatcherFor(url, settings)
  return undiciFetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
    dispatcher
  }) as unknown as Promise<Response>
}

export async function readError(response: Response): Promise<string> {
  const text = await response.text()
  return `HTTP ${response.status}: ${text.slice(0, 500)}`
}
