import { spawn, type ChildProcess } from 'node:child_process'
import { isGitCommand } from '../shared/safety'
import { outputLooped } from '../shared/creation'
import type { LogLine, RunnerState } from '../shared/types'

type Emit = (line: LogLine) => void
type StateEmit = (state: RunnerState) => void

const logs = new Map<string, LogLine[]>()
let child: ChildProcess | null = null
let active: { chatId: string; command: string } | null = null
let emitLine: Emit = () => undefined
let emitState: StateEmit = () => undefined

function push(chatId: string, stream: LogLine['stream'], text: string): void {
  const clean = text.replace(/\r/g, '').slice(0, 8000)
  if (!clean.trim()) return
  const line: LogLine = {
    id: crypto.randomUUID(),
    chatId,
    stream,
    text: clean,
    at: new Date().toISOString()
  }
  const bucket = logs.get(chatId) ?? []
  bucket.push(line)
  if (bucket.length > 800) bucket.splice(0, bucket.length - 800)
  logs.set(chatId, bucket)
  emitLine(line)
}

function publishState(): void {
  emitState(getRunnerState())
}

export function bindRunner(onLine: Emit, onState: StateEmit): void {
  emitLine = onLine
  emitState = onState
}

export function getLogs(chatId: string): LogLine[] {
  return [...(logs.get(chatId) ?? [])]
}

export function getRunnerState(): RunnerState {
  return {
    running: child !== null,
    chatId: active?.chatId ?? null,
    command: active?.command ?? null
  }
}

export function startCommand(chatId: string, command: string, cwd: string): void {
  const trimmed = command.trim()
  if (!trimmed) throw new Error('Введите команду.')
  if (isGitCommand(trimmed)) throw new Error('Git-команды запрещены. Коммиты и история репозитория остаются у вас.')
  if (child) throw new Error('Уже выполняется команда. Сначала остановите её.')

  const next = spawn(trimmed, {
    cwd,
    shell: true,
    windowsHide: true,
    env: process.env
  })
  child = next
  active = { chatId, command: trimmed }
  push(chatId, 'system', `$ ${trimmed}`)
  publishState()

  next.stdout?.on('data', (chunk: Buffer) => push(chatId, 'stdout', chunk.toString('utf8')))
  next.stderr?.on('data', (chunk: Buffer) => push(chatId, 'stderr', chunk.toString('utf8')))
  next.on('error', (error) => {
    push(chatId, 'system', error.message)
    if (child === next) {
      child = null
      active = null
      publishState()
    }
  })
  next.on('exit', (code) => {
    if (child === next) {
      push(chatId, 'system', code === null ? 'Процесс остановлен.' : `Процесс завершился с кодом ${code}.`)
      child = null
      active = null
      publishState()
    }
  })
}

export function stopCommand(): void {
  if (!child?.pid) return
  const chatId = active?.chatId
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  } else {
    child.kill('SIGTERM')
  }
  if (chatId) push(chatId, 'system', 'Останавливаю процесс.')
}

export async function runAndCollect(chatId: string, command: string, cwd: string, signal?: AbortSignal): Promise<string> {
  if (getRunnerState().running) throw new Error('Консоль уже занята другой командой.')
  startCommand(chatId, command, cwd)
  const current = child
  if (!current) throw new Error('Не удалось запустить команду.')
  return await new Promise((resolve, reject) => {
    const chunks: string[] = []
    let settled = false
    let looped = false
    const take = (chunk: Buffer) => {
      chunks.push(chunk.toString('utf8'))
      const joined = chunks.join('')
      if (chunks.length > 40 || joined.length > 100_000) chunks.splice(0, chunks.length - 20)
      if (!looped && outputLooped(joined)) {
        looped = true
        stopCommand()
      }
    }
    const finish = (handler: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      handler()
    }
    const onAbort = () => stopCommand()
    current.stdout?.on('data', take)
    current.stderr?.on('data', take)
    signal?.addEventListener('abort', onAbort, { once: true })
    current.on('error', (error) => finish(() => reject(error)))
    current.on('exit', (code) => finish(() => {
      if (looped) {
        resolve('Вывод зациклился, процесс остановлен. Для зависимостей нужна одна команда npm install с кодом 0. npm run dev, установку отдельных пакетов и правку vite.config не повторяй.\nПроцесс завершился с кодом 1.')
        return
      }
      const output = chunks.join('').slice(-12_000).trim()
      resolve(`${output}${output ? '\n' : ''}Процесс завершился с кодом ${code ?? 'null'}.`)
    }))
  })
}
