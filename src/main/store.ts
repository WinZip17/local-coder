import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { projectKey } from '../shared/safety'
import { defaultSettings, normalizeSettings } from '../shared/settings'
import type { ChatMessage, ChatRecord, ChatSummary, Settings } from '../shared/types'

let settings = defaultSettings
let chats: ChatRecord[] = []

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function chatsFile(): string {
  return path.join(app.getPath('userData'), 'chats.json')
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    await rename(file, `${file}.broken`).catch(() => undefined)
    return null
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await rename(tmp, file)
}

export async function initStore(): Promise<void> {
  settings = normalizeSettings(await readJson(settingsFile()))
  const stored = await readJson(chatsFile())
  chats = Array.isArray(stored) ? (stored as ChatRecord[]) : []
}

export function getSettings(): Settings {
  return structuredClone(settings)
}

export async function saveSettings(next: unknown): Promise<Settings> {
  settings = normalizeSettings(next)
  await writeJson(settingsFile(), settings)
  return getSettings()
}

export function listChats(): ChatSummary[] {
  return chats
    .map(({ id, title, projectPath, updatedAt }) => ({ id, title, projectPath, updatedAt }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getChat(chatId: string): ChatRecord | null {
  const chat = chats.find((item) => item.id === chatId)
  return chat ? structuredClone(chat) : null
}

export function findChatByProject(projectPath: string): ChatRecord | null {
  const key = projectKey(projectPath)
  const chat = chats.find((item) => projectKey(item.projectPath) === key)
  return chat ? structuredClone(chat) : null
}

export async function createChat(projectPath: string): Promise<ChatRecord> {
  const existing = findChatByProject(projectPath)
  if (existing) return existing
  const now = new Date().toISOString()
  const chat: ChatRecord = {
    id: crypto.randomUUID(),
    title: path.basename(projectPath) || projectPath,
    projectPath: path.resolve(projectPath),
    createdAt: now,
    updatedAt: now,
    messages: []
  }
  chats.push(chat)
  await writeJson(chatsFile(), chats)
  return structuredClone(chat)
}

export async function deleteChat(chatId: string): Promise<void> {
  chats = chats.filter((item) => item.id !== chatId)
  await writeJson(chatsFile(), chats)
}

export async function addMessage(chatId: string, message: ChatMessage): Promise<ChatRecord> {
  const chat = chats.find((item) => item.id === chatId)
  if (!chat) throw new Error('Чат не найден.')
  chat.messages.push(message)
  chat.updatedAt = message.createdAt
  await writeJson(chatsFile(), chats)
  return structuredClone(chat)
}

export function requireChat(chatId: string): ChatRecord {
  const chat = chats.find((item) => item.id === chatId)
  if (!chat) throw new Error('Чат не найден.')
  return chat
}
