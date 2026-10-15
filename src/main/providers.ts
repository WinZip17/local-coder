import { existsSync } from 'node:fs'
import { modelProblem } from '../shared/settings'
import type { Settings } from '../shared/types'
import { completeLocal } from './localModel'
import { appFetch, readError } from './net'

export interface TurnMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function batcher(emit: (text: string) => void): { push: (text: string) => void; flush: () => void } {
  let buffer = ''
  let timer: NodeJS.Timeout | null = null
  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (!buffer) return
    const text = buffer
    buffer = ''
    emit(text)
  }
  return {
    push(text: string) {
      buffer += text
      if (!timer) timer = setTimeout(flush, 40)
    },
    flush
  }
}

function completionsUrl(base: string): string {
  const trimmed = base.replace(/\/$/, '')
  if (trimmed.endsWith('/chat/completions')) return trimmed
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`
  return `${trimmed}/v1/chat/completions`
}

function modelsUrl(base: string): string {
  const trimmed = base.replace(/\/$/, '')
  if (trimmed.endsWith('/models')) return trimmed
  if (trimmed.endsWith('/v1')) return `${trimmed}/models`
  return `${trimmed}/v1/models`
}

async function readSse(response: Response, onDelta: (text: string) => void, signal?: AbortSignal): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Поток ответа пуст.')
  const decoder = new TextDecoder()
  let pending = ''
  while (true) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => undefined)
      throw new DOMException('Остановлено', 'AbortError')
    }
    const chunk = await reader.read()
    if (chunk.done) break
    pending += decoder.decode(chunk.value, { stream: true })
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (!data || data === '[DONE]') continue
      const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }
      const text = json.choices?.[0]?.delta?.content
      if (text) onDelta(text)
    }
  }
}

async function readNdjson(response: Response, onDelta: (text: string) => void, signal?: AbortSignal): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Поток ответа пуст.')
  const decoder = new TextDecoder()
  let pending = ''
  while (true) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => undefined)
      throw new DOMException('Остановлено', 'AbortError')
    }
    const chunk = await reader.read()
    if (chunk.done) break
    pending += decoder.decode(chunk.value, { stream: true })
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const json = JSON.parse(line) as { message?: { content?: string }; error?: string }
      if (json.error) throw new Error(json.error)
      if (json.message?.content) onDelta(json.message.content)
    }
  }
}

async function completeOpenAI(settings: Settings, messages: TurnMessage[], onToken: (text: string) => void, signal?: AbortSignal): Promise<string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (settings.openai.apiKey) headers.authorization = `Bearer ${settings.openai.apiKey}`
  const response = await appFetch(completionsUrl(settings.openai.baseUrl), settings, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: settings.openai.model, messages, temperature: 0.2, stream: true }),
    signal
  })
  if (!response.ok) throw new Error(await readError(response))
  let full = ''
  await readSse(response, (text) => {
    full += text
    onToken(text)
  }, signal)
  return full
}

async function completeOllama(settings: Settings, messages: TurnMessage[], onToken: (text: string) => void, signal?: AbortSignal): Promise<string> {
  const response = await appFetch(`${settings.ollama.baseUrl}/api/chat`, settings, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: settings.ollama.model, messages, stream: true, options: { temperature: 0.2 } }),
    signal
  })
  if (!response.ok) throw new Error(await readError(response))
  let full = ''
  await readNdjson(response, (text) => {
    full += text
    onToken(text)
  }, signal)
  return full
}

export async function completeChat(options: {
  settings: Settings
  messages: TurnMessage[]
  onToken: (text: string) => void
  onStatus?: (text: string) => void
  signal?: AbortSignal
}): Promise<string> {
  const problem = modelProblem(options.settings)
  if (problem) throw new Error(problem)
  const tokens = batcher(options.onToken)
  try {
    let answer = ''
    if (options.settings.activeProvider === 'local') {
      if (!existsSync(options.settings.local.modelPath)) throw new Error('Файл локальной модели не найден.')
      const [system, ...rest] = options.messages[0]?.role === 'system' ? options.messages : [{ role: 'system' as const, content: '' }, ...options.messages]
      const history = rest.filter((item) => item.role !== 'system')
      const last = history[history.length - 1]
      const prior = last?.role === 'user' ? history.slice(0, -1) : history
      const prompt = last?.role === 'user' ? last.content : 'Продолжай текущую задачу.'
      answer = await completeLocal({
        settings: options.settings,
        system: system?.content ?? '',
        history: prior
          .filter((item) => item.role === 'user' || item.role === 'assistant')
          .map((item) => ({ role: item.role as 'user' | 'assistant', content: item.content })),
        prompt,
        onToken: tokens.push,
        onStatus: options.onStatus,
        signal: options.signal
      })
    } else if (options.settings.activeProvider === 'ollama') {
      options.onStatus?.('Модель отвечает…')
      answer = await completeOllama(options.settings, options.messages, tokens.push, options.signal)
    } else {
      options.onStatus?.('Модель отвечает…')
      answer = await completeOpenAI(options.settings, options.messages, tokens.push, options.signal)
    }
    if (!answer.trim()) throw new Error('Модель вернула пустой ответ.')
    return answer
  } finally {
    tokens.flush()
  }
}

export async function listOllamaModels(baseUrl: string, settings: Settings): Promise<string[]> {
  const response = await appFetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, settings, { signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(await readError(response))
  const json = (await response.json()) as { models?: Array<{ name?: string }> }
  return (json.models ?? []).map((item) => item.name).filter((name): name is string => Boolean(name))
}

export async function listApiModels(settings: Settings): Promise<string[]> {
  const headers: Record<string, string> = {}
  if (settings.openai.apiKey) headers.authorization = `Bearer ${settings.openai.apiKey}`
  const response = await appFetch(modelsUrl(settings.openai.baseUrl), settings, { headers, signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(await readError(response))
  const json = (await response.json()) as { data?: Array<{ id?: string }> }
  return (json.data ?? []).map((item) => item.id).filter((id): id is string => Boolean(id))
}
