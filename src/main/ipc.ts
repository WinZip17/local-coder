import { existsSync } from 'node:fs'
import { dialog, type BrowserWindow } from 'electron'
import { modelProblem } from '../shared/settings'
import type { AgentEvent, Result, RunnerEvent } from '../shared/types'
import { answerRequest, cancelChat, decideRequest, isChatBusy, sendMessage } from './agent'
import { probeLocal } from './localModel'
import { ensureProjectMap } from './project'
import { listApiModels, listOllamaModels } from './providers'
import { bindRunner, getLogs, getRunnerState, startCommand, stopCommand } from './runner'
import { createChat, deleteChat, findChatByProject, getChat, getSettings, initStore, listChats, saveSettings } from './store'

function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

function fail(error: unknown): Result<never> {
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}

async function guard<T>(task: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return ok(await task())
  } catch (error) {
    return fail(error)
  }
}

export async function registerIpc(getWindow: () => BrowserWindow | null): Promise<void> {
  const { ipcMain } = await import('electron')
  await initStore()

  const send = (channel: string, payload: AgentEvent | RunnerEvent) => {
    const window = getWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send(channel, payload)
  }

  bindRunner(
    (line) => send('runner:event', { type: 'line', line }),
    (state) => send('runner:event', { type: 'state', state })
  )

  ipcMain.handle('settings:get', () => guard(() => getSettings()))
  ipcMain.handle('settings:save', (_event, input: unknown) => guard(() => saveSettings(input)))
  ipcMain.handle('ollama:list', (_event, baseUrl: string) => guard(() => listOllamaModels(baseUrl, getSettings())))
  ipcMain.handle('api:list', (_event, baseUrl: unknown, apiKey: unknown) => guard(() => {
    const settings = getSettings()
    return listApiModels({
      ...settings,
      openai: {
        ...settings.openai,
        baseUrl: typeof baseUrl === 'string' ? baseUrl : settings.openai.baseUrl,
        apiKey: typeof apiKey === 'string' ? apiKey : settings.openai.apiKey
      }
    })
  }))
  ipcMain.handle('dialog:gguf', () => guard(async () => {
    const result = await dialog.showOpenDialog({
      title: 'Файл модели GGUF',
      properties: ['openFile'],
      filters: [{ name: 'GGUF', extensions: ['gguf'] }]
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  }))
  ipcMain.handle('local:probe', () => guard(() => probeLocal(getSettings())))
  ipcMain.handle('chats:list', () => guard(() => listChats()))
  ipcMain.handle('chats:get', (_event, chatId: string) => guard(() => {
    const chat = getChat(chatId)
    if (!chat) throw new Error('Чат не найден.')
    return chat
  }))
  ipcMain.handle('chats:open', (_event, requested?: string) => guard(async () => {
    const problem = modelProblem(getSettings())
    if (problem) throw new Error(problem)
    let folder = typeof requested === 'string' ? requested.trim() : ''
    if (!folder) {
      const result = await dialog.showOpenDialog({
        title: 'Папка проекта',
        properties: ['openDirectory']
      })
      if (result.canceled || !result.filePaths[0]) return null
      folder = result.filePaths[0]
    }
    if (!existsSync(folder)) throw new Error('Папка проекта не найдена.')
    const existing = findChatByProject(folder)
    if (existing) return { chat: existing, created: false }
    const chat = await createChat(folder)
    await ensureProjectMap(chat.projectPath).catch(() => undefined)
    return { chat, created: true }
  }))
  ipcMain.handle('chats:delete', (_event, chatId: string) => guard(async () => {
    if (isChatBusy(chatId)) cancelChat(chatId)
    await deleteChat(chatId)
    return null
  }))
  ipcMain.handle('project:ensure', (_event, chatId: string) => guard(async () => {
    const chat = getChat(chatId)
    if (!chat) throw new Error('Чат не найден.')
    return ensureProjectMap(chat.projectPath)
  }))
  ipcMain.handle('agent:send', (_event, chatId: string, text: string) => guard(() => sendMessage(chatId, text, (event) => send('agent:event', event))))
  ipcMain.handle('agent:answer', (_event, requestId: string, text: string) => guard(() => answerRequest(requestId, text)))
  ipcMain.handle('agent:decide', (_event, requestId: string, approved: boolean) => guard(() => decideRequest(requestId, approved)))
  ipcMain.handle('agent:cancel', (_event, chatId: string) => guard(() => cancelChat(chatId)))
  ipcMain.handle('runner:start', (_event, chatId: string, command: string) => guard(() => {
    const problem = modelProblem(getSettings())
    if (problem) throw new Error(problem)
    const chat = getChat(chatId)
    if (!chat) throw new Error('Чат не найден.')
    startCommand(chatId, command, chat.projectPath)
    return null
  }))
  ipcMain.handle('runner:stop', () => guard(() => {
    stopCommand()
    return null
  }))
  ipcMain.handle('runner:logs', (_event, chatId: string) => guard(() => getLogs(chatId)))
  ipcMain.handle('runner:state', () => guard(() => getRunnerState()))
}
