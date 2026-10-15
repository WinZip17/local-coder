export type ProviderId = 'local' | 'ollama' | 'openai'
export type GpuMode = 'auto' | 'cuda' | 'vulkan' | 'cpu'

export interface ProxySettings {
  enabled: boolean
  protocol: 'http' | 'https' | 'socks5'
  host: string
  port: number
  username: string
  password: string
}

export interface Settings {
  activeProvider: ProviderId | null
  local: {
    modelPath: string
    gpu: GpuMode
    contextSize: number
  }
  ollama: {
    baseUrl: string
    model: string
  }
  openai: {
    baseUrl: string
    apiKey: string
    model: string
  }
  proxy: ProxySettings
}

export type MessageKind = 'text' | 'tool' | 'error'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  createdAt: string
  kind: MessageKind
}

export interface ChatSummary {
  id: string
  title: string
  projectPath: string
  updatedAt: string
}

export interface ChatRecord extends ChatSummary {
  createdAt: string
  messages: ChatMessage[]
}

export interface ProjectMap {
  version: 1
  updatedAt: string
  summary: string
  summaryFromAgent: boolean
  notes: string[]
  tree: Array<{ path: string; type: 'dir' | 'file' }>
  documents: Array<{ path: string; excerpt: string }>
}

export interface PendingRequest {
  id: string
  chatId: string
  kind: 'ask' | 'command' | 'search'
  title: string
  detail: string
}

export type AgentEvent =
  | { type: 'token'; chatId: string; text: string }
  | { type: 'message'; chatId: string; message: ChatMessage }
  | { type: 'pending'; chatId: string; request: PendingRequest }
  | { type: 'flush'; chatId: string }
  | { type: 'pending-clear'; chatId: string }
  | { type: 'status'; chatId: string; text: string }
  | { type: 'error'; chatId: string; text: string }
  | { type: 'done'; chatId: string }

export interface LogLine {
  id: string
  chatId: string
  stream: 'stdout' | 'stderr' | 'system'
  text: string
  at: string
}

export interface RunnerState {
  running: boolean
  chatId: string | null
  command: string | null
}

export type RunnerEvent =
  | { type: 'line'; line: LogLine }
  | { type: 'state'; state: RunnerState }

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export interface OpenProjectResult {
  chat: ChatRecord
  created: boolean
}

export interface ProbeResult {
  gpu: string
  message: string
}
