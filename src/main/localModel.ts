import { existsSync } from 'node:fs'
import type { GpuMode, ProbeResult, Settings } from '../shared/types'

interface GpuLayerBudget {
  max?: number
  fitContext: { contextSize: number }
}

interface LlamaHandle {
  gpu?: unknown
  loadModel: (options: {
    modelPath: string
    gpuLayers?: number | GpuLayerBudget
    onLoadProgress?: (progress: number) => void
  }) => Promise<LlamaModel>
  dispose?: () => Promise<void>
}

interface LlamaModel {
  createContext: (options?: { contextSize?: number }) => Promise<LlamaContext>
  dispose: () => Promise<void>
  gpuLayers: number
  fileInsights: { totalLayers: number }
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

const layerRetries = 8

function locked<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task)
  chain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

function cacheKey(settings: Settings, maxGpuLayers?: number): string {
  const cap = maxGpuLayers == null ? 'fit' : String(maxGpuLayers)
  return `${settings.local.modelPath}|${settings.local.gpu}|${settings.local.contextSize}|${cap}`
}

function gpuEnabled(settings: Settings, llama: LlamaHandle): boolean {
  return settings.local.gpu !== 'cpu' && llama.gpu !== false
}

function layerBudget(settings: Settings, llama: LlamaHandle, maxGpuLayers?: number): number | GpuLayerBudget {
  if (!gpuEnabled(settings, llama)) return 0
  return {
    ...(maxGpuLayers != null ? { max: maxGpuLayers } : {}),
    fitContext: { contextSize: settings.local.contextSize }
  }
}

function isVramContextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /too large for the available VRAM/i.test(message)
}

function readableModelError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/too long prompt or system message|shortening the system prompt|Failed to compress chat history/i.test(message)) {
    return new Error('Запрос не поместился в контекст, поэтому модель не начала ответ. Увеличьте «Контекст, токены» в настройках.')
  }
  return error instanceof Error ? error : new Error(message)
}

function fewerGpuLayers(current: number): number {
  return Math.max(0, current - Math.max(4, Math.ceil(current / 3)))
}

function placementMessage(model: LlamaModel, settings: Settings, gpu: string): string {
  const total = model.fileInsights.totalLayers
  const onGpu = model.gpuLayers
  const context = settings.local.contextSize
  if (gpu === 'cpu' || onGpu <= 0) {
    return `Модель загружена. Расчёт идёт на CPU, слои лежат в оперативной памяти. Контекст ${context}.`
  }
  if (total > onGpu) {
    return `Модель загружена. Расчёт: ${gpu}. На GPU ${onGpu} из ${total} слоёв, остальные ${total - onGpu} в оперативной памяти. Контекст ${context}.`
  }
  return `Модель загружена. Расчёт: ${gpu}. Все ${total} слоёв на GPU. Контекст ${context}.`
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

async function load(
  settings: Settings,
  onStatus?: (text: string) => void,
  maxGpuLayers?: number
): Promise<{ llama: LlamaHandle; model: LlamaModel }> {
  const key = cacheKey(settings, maxGpuLayers)
  if (cached?.key === key) return cached
  await disposeLocal()
  onStatus?.('Загружаю локальную модель…')
  const llamaCpp = await binding()
  const llama = await llamaCpp.getLlama(gpuOptions(settings.local.gpu))
  const model = await llama.loadModel({
    modelPath: settings.local.modelPath,
    gpuLayers: layerBudget(settings, llama, maxGpuLayers),
    onLoadProgress: (progress) => onStatus?.(`Загрузка модели ${Math.round(progress * 100)}%`)
  })
  cached = { key, llama, model }
  return cached
}

async function openContext(
  settings: Settings,
  onStatus?: (text: string) => void
): Promise<{ llama: LlamaHandle; model: LlamaModel; context: LlamaContext }> {
  let maxGpuLayers: number | undefined
  let lastError: unknown
  for (let attempt = 0; attempt < layerRetries; attempt++) {
    const loaded = await load(settings, onStatus, maxGpuLayers)
    try {
      const context = await loaded.model.createContext({ contextSize: settings.local.contextSize })
      return { ...loaded, context }
    } catch (error) {
      lastError = error
      const onGpu = loaded.model.gpuLayers
      if (!isVramContextError(error) || onGpu <= 0) throw error
      const next = fewerGpuLayers(onGpu)
      if (maxGpuLayers != null && next >= maxGpuLayers) throw error
      maxGpuLayers = next
      onStatus?.(
        `Контекст ${settings.local.contextSize} не помещается рядом с текущими слоями на GPU. Оставляю больше слоёв в оперативной памяти, на GPU будет не больше ${next}.`
      )
      await disposeLocal()
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Не удалось создать контекст модели.')
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
    const opened = await openContext(settings)
    await opened.context.dispose().catch(() => undefined)
    const gpu = opened.llama.gpu === false ? 'cpu' : String(opened.llama.gpu ?? 'cpu')
    return { gpu, message: placementMessage(opened.model, settings, gpu) }
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
    const { context } = await openContext(options.settings, options.onStatus)
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
      try {
        return await session.prompt(prompt, {
          temperature: options.settings.generation.temperature,
          maxTokens: Math.min(options.settings.generation.maxTokens, 1600, Math.max(64, options.settings.local.contextSize - 256)),
          signal: options.signal,
          onTextChunk: options.onToken
        })
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error
        throw readableModelError(error)
      }
    } finally {
      await context.dispose().catch(() => undefined)
    }
  })
}
