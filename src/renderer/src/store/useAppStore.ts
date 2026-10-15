import { create } from 'zustand'
import { modelProblem } from '../../../shared/settings'
import type { AgentEvent, RunnerEvent } from '../../../shared/types'
import type { AppStore } from '../types'

const logLimit = 800

function withBusy(ids: string[], chatId: string): string[] {
  return ids.includes(chatId) ? ids : [...ids, chatId]
}

function withoutBusy(ids: string[], chatId: string): string[] {
  return ids.filter((id) => id !== chatId)
}

export const useAppStore = create<AppStore>((set, get) => ({
  settings: null,
  chats: [],
  activeId: null,
  chat: null,
  mapText: '',
  draft: '',
  stream: '',
  status: '',
  busyIds: [],
  pending: null,
  logs: [],
  command: '',
  runner: { running: false, chatId: null, command: null },
  settingsOpen: false,
  error: '',
  notice: '',
  deleteId: null,
  answer: '',
  sidebarOpen: true,
  consoleOpen: true,

  setDraft: (draft) => set({ draft }),
  setCommand: (command) => set({ command }),
  setAnswer: (answer) => set({ answer }),
  setDeleteId: (deleteId) => set({ deleteId }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setConsoleOpen: (consoleOpen) => set({ consoleOpen }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  selectChat: (activeId) => set({ activeId }),

  applySavedSettings: (settings) => {
    set({ settings })
    if (!modelProblem(settings)) set({ settingsOpen: false })
  },

  reload: async () => {
    const [nextSettings, nextChats, state] = await Promise.all([
      window.localCoder.getSettings(),
      window.localCoder.listChats(),
      window.localCoder.getRunnerState()
    ])
    if (nextSettings.ok) set({ settings: nextSettings.data })
    else set({ error: nextSettings.error })
    if (nextChats.ok) set({ chats: nextChats.data })
    if (state.ok) set({ runner: state.data })
  },

  openProject: async () => {
    set({ error: '' })
    const opened = await window.localCoder.openProject()
    if (!opened.ok) {
      set({ error: opened.error })
      return
    }
    if (!opened.data) return
    const listed = await window.localCoder.listChats()
    if (listed.ok) set({ chats: listed.data })
    set({
      activeId: opened.data.chat.id,
      notice: opened.data.created ? '' : 'Этот проект уже открыт. Контекст тот же.'
    })
  },

  removeChat: async (chatId) => {
    const removed = await window.localCoder.deleteChat(chatId)
    if (!removed.ok) {
      set({ error: removed.error })
      return
    }
    set((state) => ({
      activeId: state.activeId === chatId ? null : state.activeId,
      deleteId: null
    }))
    const listed = await window.localCoder.listChats()
    if (listed.ok) set({ chats: listed.data })
  },

  send: async () => {
    const { activeId, draft } = get()
    if (!activeId || !draft.trim()) return
    const text = draft
    set((state) => ({
      draft: '',
      error: '',
      busyIds: withBusy(state.busyIds, activeId)
    }))
    const result = await window.localCoder.sendMessage(activeId, text)
    if (!result.ok) {
      set((state) => ({
        error: result.error,
        busyIds: withoutBusy(state.busyIds, activeId)
      }))
    }
  },

  submitAnswer: async () => {
    const { pending, answer } = get()
    if (!pending || !answer.trim()) return
    const text = answer
    set({ answer: '' })
    const result = await window.localCoder.answer(pending.id, text)
    if (!result.ok) set({ error: result.error })
  },

  decide: async (approved) => {
    const pending = get().pending
    if (!pending) return
    const result = await window.localCoder.decide(pending.id, approved)
    if (!result.ok) set({ error: result.error })
  },

  run: async () => {
    const { activeId, command } = get()
    if (!activeId || !command.trim()) return
    set({ error: '' })
    const result = await window.localCoder.runCommand(activeId, command)
    if (!result.ok) set({ error: result.error })
  },

  refreshMap: async () => {
    const activeId = get().activeId
    if (!activeId) return
    const result = await window.localCoder.ensureMap(activeId)
    if (!result.ok) set({ error: result.error })
    else set({ mapText: result.data.summary })
  },

  cancelActive: async () => {
    const chatId = get().chat?.id
    if (!chatId) return
    await window.localCoder.cancel(chatId)
  },

  stopCommand: () => {
    void window.localCoder.stopCommand()
  },

  beginChatSwitch: (activeId) => {
    if (!activeId) {
      set({ stream: '', status: '', error: '', notice: '', chat: null, logs: [], mapText: '' })
      return
    }
    set({ stream: '', status: '', error: '', notice: '' })
  },

  acceptChat: (record) => {
    set((state) => {
      if (state.activeId !== record.id) return {}
      if (state.chat?.id === record.id && state.chat.messages.length >= record.messages.length) return {}
      return { chat: record }
    })
  },

  acceptLogs: (chatId, logs) => {
    if (get().activeId !== chatId) return
    set({ logs })
  },

  acceptMap: (chatId, summary) => {
    if (get().activeId !== chatId) return
    set({ mapText: summary })
  },

  applyAgentEvent: (event) => {
    applyAgentEvent(set, event)
  },

  applyRunnerEvent: (event) => {
    applyRunnerEvent(set, get, event)
  }
}))

function applyAgentEvent(set: (partial: Partial<AppStore> | ((state: AppStore) => Partial<AppStore>)) => void, event: AgentEvent) {
  if (event.type === 'token') {
    set((state) => ({
      busyIds: withBusy(state.busyIds, event.chatId),
      stream: event.chatId === state.activeId ? state.stream + event.text : state.stream
    }))
    return
  }
  if (event.type === 'flush') {
    set((state) => (event.chatId === state.activeId ? { stream: '' } : {}))
    return
  }
  if (event.type === 'status') {
    set((state) => ({
      busyIds: event.text ? withBusy(state.busyIds, event.chatId) : state.busyIds,
      status: event.chatId === state.activeId ? event.text : state.status
    }))
    return
  }
  if (event.type === 'message') {
    set((state) => {
      if (!state.chat || state.chat.id !== event.chatId) return {}
      if (state.chat.messages.some((item) => item.id === event.message.id)) return {}
      return { chat: { ...state.chat, messages: [...state.chat.messages, event.message] } }
    })
    return
  }
  if (event.type === 'pending') {
    set({ pending: event.request })
    return
  }
  if (event.type === 'pending-clear') {
    set((state) => (state.pending?.chatId === event.chatId ? { pending: null } : {}))
    return
  }
  if (event.type === 'error') {
    set((state) => (event.chatId === state.activeId ? { error: event.text } : {}))
    return
  }
  if (event.type === 'done') {
    set((state) => ({
      busyIds: withoutBusy(state.busyIds, event.chatId),
      stream: event.chatId === state.activeId ? '' : state.stream,
      status: event.chatId === state.activeId ? '' : state.status
    }))
    void window.localCoder.listChats().then((result) => {
      if (result.ok) set({ chats: result.data })
    })
  }
}

function applyRunnerEvent(
  set: (partial: Partial<AppStore> | ((state: AppStore) => Partial<AppStore>)) => void,
  get: () => AppStore,
  event: RunnerEvent
) {
  if (event.type === 'line' && event.line.chatId === get().activeId) {
    set((state) => ({ logs: [...state.logs, event.line].slice(-logLimit) }))
    return
  }
  if (event.type === 'state') set({ runner: event.state })
}

export function selectActivePending(state: AppStore) {
  return state.pending?.chatId === state.activeId ? state.pending : null
}

export function selectChatBusy(state: AppStore): boolean {
  return state.activeId ? state.busyIds.includes(state.activeId) : false
}
