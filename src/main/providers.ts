import { existsSync } from 'node:fs'
import { modelProblem } from '../shared/settings'
import type { Settings } from '../shared/types'
import { completeLocal } from './localModel'
import { appFetch, describeNetworkError, readError } from './net'

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

async function readSse(response: Response, onDelta: (text: string) => void, signal?: AbortSignal): Promise<{ content: string; reasoning: string }> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Поток ответа пуст.')
  const decoder = new TextDecoder()
  let pending = ''
  let content = ''
  let reasoning = ''
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
      let json: { choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null } }> }
      try {
        json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null } }> }
      } catch {
        continue
      }
      const delta = json.choices?.[0]?.delta
      if (delta?.content) {
        content += delta.content
        onDelta(delta.content)
      }
      if (delta?.reasoning_content) reasoning += delta.reasoning_content
    }
  }
  return { content, reasoning }
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

const defaultTemperatureOnly = new Set<string>()
const tokenLimitField = new Map<string, 'max_tokens' | 'max_completion_tokens' | 'omit'>()

function temperatureRejected(error: string): boolean {
  return /temperature/i.test(error) && /unsupported_value|does not support|only the default/i.test(error)
}

function tokenLimitRejected(error: string): 'max_tokens' | 'max_completion_tokens' | null {
  if (!/unsupported|unrecognized|unknown|does not support/i.test(error)) return null
  const quoted = error.match(/['"](max_completion_tokens|max_tokens)['"]/i)
  if (quoted?.[1]?.toLowerCase() === 'max_completion_tokens') return 'max_completion_tokens'
  if (quoted?.[1]?.toLowerCase() === 'max_tokens') return 'max_tokens'
  if (/max_completion_tokens/i.test(error)) return 'max_completion_tokens'
  if (/max_tokens/i.test(error)) return 'max_tokens'
  return null
}

function withGeneration(model: string, temperature: number, maxTokens: number): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (!defaultTemperatureOnly.has(model)) body.temperature = temperature
  const field = tokenLimitField.get(model) ?? 'max_tokens'
  if (field !== 'omit') body[field] = maxTokens
  return body
}

async function completeOpenAI(settings: Settings, messages: TurnMessage[], onToken: (text: string) => void, signal?: AbortSignal): Promise<string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (settings.openai.apiKey) headers.authorization = `Bearer ${settings.openai.apiKey}`
  const model = settings.openai.model
  const url = completionsUrl(settings.openai.baseUrl)
  let response: Response | null = null
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const body = {
      model,
      messages,
      stream: true,
      ...withGeneration(model, settings.generation.temperature, settings.generation.maxTokens)
    }
    try {
      response = await appFetch(url, settings, { method: 'POST', headers, body: JSON.stringify(body), signal })
    } catch (error) {
      throw describeNetworkError(error)
    }
    if (response.ok) break
    const error = await readError(response)
    if (temperatureRejected(error) && !defaultTemperatureOnly.has(model)) {
      defaultTemperatureOnly.add(model)
      continue
    }
    const rejectedLimit = tokenLimitRejected(error)
    const currentLimit = tokenLimitField.get(model) ?? 'max_tokens'
    if (rejectedLimit === currentLimit && currentLimit === 'max_tokens') {
      tokenLimitField.set(model, 'max_completion_tokens')
      continue
    }
    if (rejectedLimit === currentLimit) {
      tokenLimitField.set(model, 'omit')
      continue
    }
    throw new Error(error)
  }
  if (!response || !response.ok) throw new Error('API не приняло параметры генерации.')
  try {
    const streamed = await readSse(response, onToken, signal)
    if (!streamed.content.trim() && streamed.reasoning.trim()) onToken(streamed.reasoning)
    return streamed.content.trim() ? streamed.content : streamed.reasoning
  } catch (error) {
    throw describeNetworkError(error)
  }
}

async function completeOllama(settings: Settings, messages: TurnMessage[], onToken: (text: string) => void, signal?: AbortSignal): Promise<string> {
  const response = await appFetch(`${settings.ollama.baseUrl}/api/chat`, settings, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: settings.ollama.model,
      messages,
      stream: true,
      options: { temperature: settings.generation.temperature, num_predict: settings.generation.maxTokens }
    }),
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
  const base = settings.openai.baseUrl.trim()
  if (!base) throw new Error('Укажите адрес API.')
  try {
    const url = new URL(base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Адрес API должен начинаться с http:// или https://.')
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Адрес API')) throw error
    throw new Error('Адрес API некорректный.')
  }
  const headers: Record<string, string> = {}
  if (settings.openai.apiKey) headers.authorization = `Bearer ${settings.openai.apiKey}`
  const response = await appFetch(modelsUrl(settings.openai.baseUrl), settings, { headers, signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(await readError(response))
  const json = (await response.json()) as { data?: Array<{ id?: string }> }
  return (json.data ?? []).map((item) => item.id).filter((id): id is string => Boolean(id))
}
