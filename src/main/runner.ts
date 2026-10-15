import { spawn, type ChildProcess } from 'node:child_process'
import { isGitCommand } from '../shared/safety'
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
    const take = (chunk: Buffer) => {
      chunks.push(chunk.toString('utf8'))
      if (chunks.join('').length > 100_000) chunks.splice(0, chunks.length - 20)
    }
    current.stdout?.on('data', take)
    current.stderr?.on('data', take)
    const onAbort = () => stopCommand()
    signal?.addEventListener('abort', onAbort, { once: true })
    current.on('error', (error) => {
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    current.on('exit', (code) => {
      signal?.removeEventListener('abort', onAbort)
      const output = chunks.join('').slice(-100_000)
      resolve(output.trim() ? output : `Команда завершилась с кодом ${code ?? 'null'} без вывода.`)
    })
  })
}
