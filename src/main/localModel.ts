import { existsSync } from 'node:fs'
import type { GpuMode, ProbeResult, Settings } from '../shared/types'

interface LlamaHandle {
  gpu?: unknown
  loadModel: (options: {
    modelPath: string
    onLoadProgress?: (progress: number) => void
  }) => Promise<LlamaModel>
  dispose?: () => Promise<void>
}

interface LlamaModel {
  createContext: (options?: { contextSize?: number }) => Promise<LlamaContext>
  dispose: () => Promise<void>
}

interface LlamaContext {
  getSequence: () => unknown
  dispose: () => Promise<void>
}

interface LlamaSession {
  prompt: (
    text: string,
    options?: {
      onTextChunk?: (chunk: string) => void
      signal?: AbortSignal
      temperature?: number
      maxTokens?: number
    }
  ) => Promise<string>
  setChatHistory?: (history: unknown[]) => void
}

interface LlamaModule {
  getLlama: (options?: { gpu?: 'cuda' | 'vulkan' | 'metal' | false; build?: 'never' }) => Promise<LlamaHandle>
  LlamaChatSession: new (options: { contextSequence: unknown; systemPrompt?: string }) => LlamaSession
}

interface Turn {
  role: 'user' | 'assistant'
  content: string
}

let chain: Promise<unknown> = Promise.resolve()
let cached: { key: string; llama: LlamaHandle; model: LlamaModel } | null = null

function locked<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task)
  chain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

function cacheKey(settings: Settings): string {
  return `${settings.local.modelPath}|${settings.local.gpu}|${settings.local.contextSize}`
}

async function binding(): Promise<LlamaModule> {
  try {
    return (await import('node-llama-cpp')) as unknown as LlamaModule
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Локальный движок llama.cpp не загрузился. ${message}`)
  }
}

function gpuOptions(gpu: GpuMode): { gpu?: 'cuda' | 'vulkan' | 'metal' | false; build: 'never' } {
  if (gpu === 'cpu') return { gpu: false, build: 'never' }
  if (gpu === 'auto') return { build: 'never' }
  return { gpu, build: 'never' }
}

async function load(settings: Settings, onStatus?: (text: string) => void): Promise<{ llama: LlamaHandle; model: LlamaModel }> {
  const key = cacheKey(settings)
  if (cached?.key === key) return cached
  await disposeLocal()
  onStatus?.('Загружаю локальную модель…')
  const llamaCpp = await binding()
  const llama = await llamaCpp.getLlama(gpuOptions(settings.local.gpu))
  const model = await llama.loadModel({
    modelPath: settings.local.modelPath,
    onLoadProgress: (progress) => onStatus?.(`Загрузка модели ${Math.round(progress * 100)}%`)
  })
  cached = { key, llama, model }
  return cached
}

export async function disposeLocal(): Promise<void> {
  const current = cached
  cached = null
  if (!current) return
  await current.model.dispose().catch(() => undefined)
  await current.llama.dispose?.().catch(() => undefined)
}

export async function probeLocal(settings: Settings): Promise<ProbeResult> {
  if (!existsSync(settings.local.modelPath)) throw new Error('Файл локальной модели не найден.')
  return locked(async () => {
    const loaded = await load(settings, () => undefined)
    const gpu = loaded.llama.gpu === false ? 'cpu' : String(loaded.llama.gpu ?? 'cpu')
    const message = gpu === 'cpu'
      ? 'Модель загружена. CUDA и Vulkan не прошли проверку, расчёт пойдёт на CPU.'
      : `Модель загружена. Расчёт: ${gpu}.`
    return { gpu, message }
  })
}

export async function completeLocal(options: {
  settings: Settings
  system: string
  history: Turn[]
  prompt: string
  onToken: (text: string) => void
  onStatus?: (text: string) => void
  signal?: AbortSignal
}): Promise<string> {
  return locked(async () => {
    const llamaCpp = await binding()
    const loaded = await load(options.settings, options.onStatus)
    const context = await loaded.model.createContext({ contextSize: options.settings.local.contextSize })
    try {
      const session = new llamaCpp.LlamaChatSession({
        contextSequence: context.getSequence(),
        systemPrompt: options.system
      })
      const prior = options.history.map((item) =>
        item.role === 'user'
          ? { type: 'user', text: item.content }
          : { type: 'model', response: [item.content] }
      )
      let prompt = options.prompt
      if (prior.length > 0 && session.setChatHistory) {
        try {
          session.setChatHistory(prior)
        } catch {
          prompt = `${prior
            .map((item) => `${item.type === 'user' ? 'Пользователь' : 'Ассистент'}: ${'text' in item ? item.text : item.response[0]}`)
            .join('\n\n')}\n\nПользователь: ${options.prompt}`
        }
      }
      options.onStatus?.('Модель отвечает…')
      const answer = await session.prompt(prompt, {
        temperature: 0.2,
        maxTokens: 2048,
        signal: options.signal,
        onTextChunk: options.onToken
      })
      return answer
    } finally {
      await context.dispose().catch(() => undefined)
    }
  })
}
