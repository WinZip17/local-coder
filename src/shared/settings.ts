import type { Settings } from './types'

export const defaultSettings: Settings = {
  activeProvider: null,
  local: {
    modelPath: '',
    gpu: 'auto',
    contextSize: 8192
  },
  ollama: {
    baseUrl: 'http://127.0.0.1:11434',
    model: ''
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: ''
  },
  proxy: {
    enabled: false,
    protocol: 'http',
    host: '',
    port: 8080,
    username: '',
    password: ''
  }
}

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

export function normalizeSettings(input: unknown): Settings {
  const source = input && typeof input === 'object' ? (input as Partial<Settings>) : {}
  const local = source.local ?? defaultSettings.local
  const ollama = source.ollama ?? defaultSettings.ollama
  const openai = source.openai ?? defaultSettings.openai
  const proxy = source.proxy ?? defaultSettings.proxy
  const provider = source.activeProvider
  const gpu = local.gpu
  const protocol = proxy.protocol
  const contextSize = Number(local.contextSize)

  return {
    activeProvider: provider === 'local' || provider === 'ollama' || provider === 'openai' ? provider : null,
    local: {
      modelPath: asText(local.modelPath),
      gpu: gpu === 'cuda' || gpu === 'vulkan' || gpu === 'cpu' || gpu === 'auto' ? gpu : 'auto',
      contextSize: Number.isFinite(contextSize) ? Math.round(contextSize) : defaultSettings.local.contextSize
    },
    ollama: {
      baseUrl: asText(ollama.baseUrl, defaultSettings.ollama.baseUrl).replace(/\/$/, ''),
      model: asText(ollama.model)
    },
    openai: {
      baseUrl: asText(openai.baseUrl, defaultSettings.openai.baseUrl).replace(/\/$/, ''),
      apiKey: typeof openai.apiKey === 'string' ? openai.apiKey.trim() : '',
      model: asText(openai.model)
    },
    proxy: {
      enabled: Boolean(proxy.enabled),
      protocol: protocol === 'https' || protocol === 'socks5' || protocol === 'http' ? protocol : 'http',
      host: asText(proxy.host),
      port: Number.isFinite(Number(proxy.port)) ? Math.round(Number(proxy.port)) : defaultSettings.proxy.port,
      username: typeof proxy.username === 'string' ? proxy.username : '',
      password: typeof proxy.password === 'string' ? proxy.password : ''
    }
  }
}

export function modelProblem(settings: Settings): string | null {
  if (!settings.activeProvider) return 'Выберите тип модели.'

  if (settings.activeProvider === 'local') {
    if (!settings.local.modelPath) return 'Укажите файл модели GGUF.'
    if (!settings.local.modelPath.toLowerCase().endsWith('.gguf')) return 'Локальная модель должна быть файлом .gguf.'
    if (settings.local.contextSize < 512 || settings.local.contextSize > 262144) {
      return 'Размер контекста должен быть от 512 до 262144.'
    }
  }

  if (settings.activeProvider === 'ollama') {
    if (!settings.ollama.baseUrl) return 'Укажите адрес Ollama.'
    try {
      const url = new URL(settings.ollama.baseUrl)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Адрес Ollama должен начинаться с http:// или https://.'
    } catch {
      return 'Адрес Ollama некорректный.'
    }
    if (!settings.ollama.model) return 'Выберите модель Ollama.'
  }

  if (settings.activeProvider === 'openai') {
    if (!settings.openai.baseUrl) return 'Укажите адрес API.'
    try {
      const url = new URL(settings.openai.baseUrl)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Адрес API должен начинаться с http:// или https://.'
    } catch {
      return 'Адрес API некорректный.'
    }
    if (!settings.openai.model) return 'Укажите имя модели API.'
  }

  if (settings.proxy.enabled) {
    if (!settings.proxy.host) return 'Укажите хост прокси.'
    if (settings.proxy.port < 1 || settings.proxy.port > 65535) return 'Порт прокси должен быть от 1 до 65535.'
  }

  return null
}

export function activeModelLabel(settings: Settings): string {
  if (settings.activeProvider === 'local') {
    const name = settings.local.modelPath.split(/[\\/]/).pop() || 'GGUF'
    return `Локальная · ${name}`
  }
  if (settings.activeProvider === 'ollama') return `Ollama · ${settings.ollama.model}`
  if (settings.activeProvider === 'openai') return `API · ${settings.openai.model}`
  return 'Модель не выбрана'
}
