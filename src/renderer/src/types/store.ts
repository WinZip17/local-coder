import type {
  AgentEvent,
  ChatRecord,
  ChatSummary,
  LogLine,
  PendingRequest,
  RunnerEvent,
  RunnerState,
  Settings
} from '../../../shared/types'

export interface AppData {
  settings: Settings | null
  chats: ChatSummary[]
  activeId: string | null
  chat: ChatRecord | null
  mapText: string
  draft: string
  stream: string
  status: string
  busyIds: string[]
  pending: PendingRequest | null
  logs: LogLine[]
  command: string
  runner: RunnerState
  settingsOpen: boolean
  error: string
  notice: string
  deleteId: string | null
  answer: string
  sidebarOpen: boolean
  consoleOpen: boolean
}

export interface AppActions {
  setDraft: (draft: string) => void
  setCommand: (command: string) => void
  setAnswer: (answer: string) => void
  setDeleteId: (deleteId: string | null) => void
  setSidebarOpen: (sidebarOpen: boolean) => void
  setConsoleOpen: (consoleOpen: boolean) => void
  openSettings: () => void
  closeSettings: () => void
  selectChat: (activeId: string) => void
  applySavedSettings: (settings: Settings) => void
  reload: () => Promise<void>
  openProject: () => Promise<void>
  removeChat: (chatId: string) => Promise<void>
  send: () => Promise<void>
  submitAnswer: () => Promise<void>
  decide: (approved: boolean) => Promise<void>
  run: () => Promise<void>
  refreshMap: () => Promise<void>
  cancelActive: () => Promise<void>
  stopCommand: () => void
  beginChatSwitch: (activeId: string | null) => void
  acceptChat: (record: ChatRecord) => void
  acceptLogs: (chatId: string, logs: LogLine[]) => void
  acceptMap: (chatId: string, summary: string) => void
  applyAgentEvent: (event: AgentEvent) => void
  applyRunnerEvent: (event: RunnerEvent) => void
}

export type AppStore = AppData & AppActions
