import type { Settings } from '../shared/types'
import { appFetch, readError } from './net'

export interface SearchHit {
  title: string
  url: string
  snippet: string
}

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function unwrapLink(href: string): string {
  try {
    const url = new URL(href, 'https://duckduckgo.com')
    const target = url.searchParams.get('uddg')
    return target ? decodeURIComponent(target) : url.toString()
  } catch {
    return href
  }
}

export async function searchWeb(query: string, settings: Settings, signal?: AbortSignal): Promise<SearchHit[]> {
  const trimmed = query.trim()
  if (!trimmed) throw new Error('Пустой поисковый запрос.')
  const response = await appFetch('https://html.duckduckgo.com/html/', settings, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'text/html',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    },
    body: new URLSearchParams({ q: trimmed.slice(0, 300) }).toString(),
    signal
  })
  if (!response.ok) throw new Error(await readError(response))
  const html = await response.text()
  const hits: SearchHit[] = []
  const blockRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,800}?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
  for (const match of html.matchAll(blockRe)) {
    if (hits.length >= 5) break
    const url = unwrapLink(match[1] ?? '')
    const title = decodeHtml(match[2] ?? '')
    const snippet = decodeHtml(match[3] ?? '')
    if (!title || !url) continue
    hits.push({ title, url, snippet })
  }
  return hits
}
