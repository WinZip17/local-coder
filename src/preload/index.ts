import { contextBridge, ipcRenderer } from 'electron'
import type { LocalCoderApi } from '../shared/api'
import type { AgentEvent, RunnerEvent, Settings } from '../shared/types'

const api: LocalCoderApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Settings) => ipcRenderer.invoke('settings:save', settings),
  listOllamaModels: (baseUrl) => ipcRenderer.invoke('ollama:list', baseUrl),
  listApiModels: (baseUrl, apiKey) => ipcRenderer.invoke('api:list', baseUrl, apiKey),
  pickGguf: () => ipcRenderer.invoke('dialog:gguf'),
  probeLocal: () => ipcRenderer.invoke('local:probe'),
  listChats: () => ipcRenderer.invoke('chats:list'),
  openProject: (folder?: string) => ipcRenderer.invoke('chats:open', folder),
  deleteChat: (chatId) => ipcRenderer.invoke('chats:delete', chatId),
  getChat: (chatId) => ipcRenderer.invoke('chats:get', chatId),
  ensureMap: (chatId) => ipcRenderer.invoke('project:ensure', chatId),
  sendMessage: (chatId, text) => ipcRenderer.invoke('agent:send', chatId, text),
  answer: (requestId, text) => ipcRenderer.invoke('agent:answer', requestId, text),
  decide: (requestId, approved) => ipcRenderer.invoke('agent:decide', requestId, approved),
  cancel: (chatId) => ipcRenderer.invoke('agent:cancel', chatId),
  runCommand: (chatId, command) => ipcRenderer.invoke('runner:start', chatId, command),
  stopCommand: () => ipcRenderer.invoke('runner:stop'),
  getLogs: (chatId) => ipcRenderer.invoke('runner:logs', chatId),
  getRunnerState: () => ipcRenderer.invoke('runner:state'),
  onAgentEvent: (listener) => {
    const wrapped = (_event: unknown, payload: AgentEvent) => listener(payload)
    ipcRenderer.on('agent:event', wrapped)
    return () => ipcRenderer.removeListener('agent:event', wrapped)
  },
  onRunnerEvent: (listener) => {
    const wrapped = (_event: unknown, payload: RunnerEvent) => listener(payload)
    ipcRenderer.on('runner:event', wrapped)
    return () => ipcRenderer.removeListener('runner:event', wrapped)
  }
}

contextBridge.exposeInMainWorld('localCoder', api)
