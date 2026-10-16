import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { describedLineEdit, describedSnippets, snippetToEdit } from '../shared/edits'
import type { ToolCall } from '../shared/parse'
import { parseModelOutput, shouldNudgeFileEdit } from '../shared/parse'
import { resolveInsideProject } from '../shared/safety'
import { modelProblem } from '../shared/settings'
import type { AgentEvent, ChatMessage, PendingRequest } from '../shared/types'
import { searchWeb } from './search'
import { getSettings, addMessage, requireChat } from './store'
import { buildSystemPrompt, ensureProjectMap } from './project'
import { completeChat, type TurnMessage } from './providers'
import { runAndCollect } from './runner'
import { executeTool } from './tools'

const busy = new Set<string>()
const controllers = new Map<string, AbortController>()
const waiters = new Map<string, (value: { approved: boolean; text: string }) => void>()

const MAX_STEPS = 8

function makeMessage(role: ChatMessage['role'], content: string, kind: ChatMessage['kind']): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
    kind
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /abort|останов/i.test(error.message))
}

function previousAssistant(chatId: string): string {
  const messages = requireChat(chatId).messages
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') return messages[index]?.content ?? ''
  }
  return ''
}

function sameText(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase()
  const first = normalize(left)
  const second = normalize(right)
  return first.length > 0 && first === second
}

function lastUserText(chatId: string): string {
  const messages = requireChat(chatId).messages
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return messages[index]?.content ?? ''
  }
  return ''
}

function nudgeText(visible: string): string {
  if (/не могу|доступа к файловой|текстов|cannot|can't access|no access|text AI/i.test(visible)) {
    return 'Файлы проекта доступны через инструменты. Не пиши, что ты текстовый AI или что нет доступа к файловой системе. Сразу вызови write_file для нового файла или read_file и edit_file для существующего. Текст ответа файлы не меняет.'
  }
  return 'Файлы не изменены. Код и инструкции в ответе не применяются. Прочитай нужный файл через read_file и сразу вызови write_file или edit_file. Не описывай правку текстом и не отправляй пользователя в терминал.'
}

function transcript(chatId: string): TurnMessage[] {
  const items: TurnMessage[] = []
  for (const message of requireChat(chatId).messages) {
    if (message.role === 'assistant') items.push({ role: 'assistant', content: message.content })
    else if (message.role === 'user') items.push({ role: 'user', content: message.content })
    else items.push({ role: 'user', content: `Результат инструмента:\n${message.content}` })
  }
  const collapsed: TurnMessage[] = []
  for (const item of items) {
    const last = collapsed[collapsed.length - 1]
    if (last && last.role === item.role) last.content += `\n\n${item.content}`
    else collapsed.push({ ...item })
  }
  while (collapsed[0]?.role === 'assistant') collapsed.shift()
  return collapsed.slice(-24)
}

function waitForUser(request: PendingRequest, emit: (event: AgentEvent) => void, signal: AbortSignal): Promise<{ approved: boolean; text: string }> {
  emit({ type: 'pending', chatId: request.chatId, request })
  return new Promise((resolve, reject) => {
    const finish = (value: { approved: boolean; text: string }) => {
      signal.removeEventListener('abort', onAbort)
      waiters.delete(request.id)
      emit({ type: 'pending-clear', chatId: request.chatId })
      resolve(value)
    }
    const onAbort = () => {
      waiters.delete(request.id)
      emit({ type: 'pending-clear', chatId: request.chatId })
      reject(new DOMException('Остановлено', 'AbortError'))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    waiters.set(request.id, finish)
  })
}

const SOURCE_EXT = new Set(['ts', 'tsx', 'js', 'jsx', 'vue', 'svelte', 'css', 'scss', 'html', 'json', 'py', 'go', 'rs', 'java', 'kt', 'cs', 'php', 'rb'])
const SKIP_DIRS = new Set(['node_modules', '.git', '.local-coder', 'dist', 'build', 'out', 'release', 'coverage', '.next', '.nuxt', 'target', 'vendor', '__pycache__', '.venv', 'venv', 'bin', 'obj'])

async function sourceFiles(root: string): Promise<Array<{ path: string; text: string }>> {
  const files: Array<{ path: string; text: string }> = []
  const walk = async (dir: string): Promise<void> => {
    if (files.length >= 2000) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= 2000) return
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        await walk(path.join(dir, entry.name))
        continue
      }
      const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
      if (!SOURCE_EXT.has(ext)) continue
      const full = path.join(dir, entry.name)
      try {
        const info = await stat(full)
        if (info.size > 400_000) continue
        const text = await readFile(full, 'utf8')
        files.push({ path: path.relative(root, full).split(path.sep).join('/'), text })
      } catch {
        continue
      }
    }
  }
  await walk(root)
  return files
}

async function editsFromAnswer(projectPath: string, visible: string, userText: string): Promise<ToolCall[]> {
  const calls: ToolCall[] = []
  for (const item of describedSnippets(visible)) {
    let target = ''
    try {
      target = resolveInsideProject(projectPath, item.path)
    } catch {
      continue
    }
    let fileText = ''
    try {
      fileText = await readFile(target, 'utf8')
    } catch {
      calls.push({
        name: 'write_file',
        arguments: { path: item.path, content: item.snippet.endsWith('\n') ? item.snippet : `${item.snippet}\n` }
      })
      continue
    }
    const edit = snippetToEdit(fileText, item.snippet)
    if (!edit) continue
    calls.push({
      name: 'edit_file',
      arguments: { path: item.path, oldText: edit.oldText, newText: edit.newText }
    })
  }
  if (!calls.length) {
    const line = describedLineEdit(await sourceFiles(projectPath), userText, visible)
    if (line) calls.push({ name: 'edit_file', arguments: { path: line.path, oldText: line.oldText, newText: line.newText } })
  }
  return calls
}

async function runTool(chatId: string, projectPath: string, call: ToolCall, emit: (event: AgentEvent) => void, signal: AbortSignal): Promise<string> {
  if (call.name === 'ask_user') {
    const question = typeof call.arguments.question === 'string' ? call.arguments.question.trim() : ''
    if (!question) return 'ask_user: пустой вопрос.'
    const answer = await waitForUser({
      id: crypto.randomUUID(),
      chatId,
      kind: 'ask',
      title: 'Нужно уточнение',
      detail: question
    }, emit, signal)
    return `ask_user\nВопрос: ${question}\nОтвет пользователя: ${answer.text}`
  }

  if (call.name === 'run_command') {
    const command = typeof call.arguments.command === 'string' ? call.arguments.command.trim() : ''
    if (!command) return 'run_command: пустая команда.'
    const decision = await waitForUser({
      id: crypto.randomUUID(),
      chatId,
      kind: 'command',
      title: 'Подтвердите команду',
      detail: command
    }, emit, signal)
    if (!decision.approved) return `run_command отклонён пользователем:\n${command}`
    emit({ type: 'status', chatId, text: 'Выполняю команду…' })
    try {
      const output = await runAndCollect(chatId, command, projectPath, signal)
      return `run_command ${command}\n${output}`
    } catch (error) {
      return `run_command ошибка: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  if (call.name === 'web_search') {
    const query = typeof call.arguments.query === 'string' ? call.arguments.query.trim() : ''
    if (!query) return 'web_search: пустой запрос.'
    const decision = await waitForUser({
      id: crypto.randomUUID(),
      chatId,
      kind: 'search',
      title: 'Искать в интернете?',
      detail: query
    }, emit, signal)
    if (!decision.approved) return `web_search отклонён пользователем:\n${query}`
    emit({ type: 'status', chatId, text: 'Ищу в интернете…' })
    try {
      const hits = await searchWeb(query, getSettings(), signal)
      if (!hits.length) return `web_search ${query}\nНичего не найдено.`
      return `web_search ${query}\n${hits.map((hit, index) => `${index + 1}. ${hit.title}\n${hit.url}\n${hit.snippet}`).join('\n\n')}`
    } catch (error) {
      return `web_search ошибка: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  try {
    emit({ type: 'status', chatId, text: `Инструмент ${call.name}…` })
    return await executeTool(projectPath, call)
  } catch (error) {
    return `${call.name} ошибка: ${error instanceof Error ? error.message : String(error)}`
  }
}

async function runLoop(chatId: string, emit: (event: AgentEvent) => void, signal: AbortSignal): Promise<void> {
  const projectPath = requireChat(chatId).projectPath
  emit({ type: 'status', chatId, text: 'Обновляю карту проекта…' })
  let map = await ensureProjectMap(projectPath)
  let edited = false
  let nudges = 0

  for (let step = 1; step <= MAX_STEPS; step += 1) {
    if (signal.aborted) throw new DOMException('Остановлено', 'AbortError')
    emit({ type: 'status', chatId, text: `Шаг ${step} из ${MAX_STEPS}` })
    const settings = getSettings()
    const problem = modelProblem(settings)
    if (problem) throw new Error(problem)
    const contextSize = settings.activeProvider === 'local' ? settings.local.contextSize : 8192
    let streamed = ''
    let output = ''
    try {
      output = await completeChat({
        settings,
        messages: [{ role: 'system', content: buildSystemPrompt(projectPath, map, contextSize) }, ...transcript(chatId)],
        onToken: (text) => {
          streamed += text
          emit({ type: 'token', chatId, text })
        },
        onStatus: (text) => emit({ type: 'status', chatId, text }),
        signal
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (step < MAX_STEPS && /пустой ответ/.test(message)) {
        emit({ type: 'flush', chatId })
        const reminder = makeMessage('tool', 'Ответ пустой. Прочитай файл с offset 1 и вызови edit_file с точным фрагментом.', 'tool')
        await addMessage(chatId, reminder)
        emit({ type: 'message', chatId, message: reminder })
        continue
      }
      throw error
    }
    emit({ type: 'flush', chatId })
    const parsed = parseModelOutput(output || streamed)
    if (parsed.visible && sameText(parsed.visible, previousAssistant(chatId))) return
    const alreadyWrites = parsed.calls.some((call) => call.name === 'edit_file' || call.name === 'write_file')
    if (!edited && !alreadyWrites && parsed.visible) {
      parsed.calls.push(...await editsFromAnswer(projectPath, parsed.visible, lastUserText(chatId)))
    }
    if (parsed.visible) {
      const message = makeMessage('assistant', parsed.visible, 'text')
      await addMessage(chatId, message)
      emit({ type: 'message', chatId, message })
    }
    if (!parsed.calls.length && !parsed.errors.length) {
      if (!edited && step < MAX_STEPS && shouldNudgeFileEdit(parsed.visible, lastUserText(chatId), nudges)) {
        nudges += 1
        const reminder = makeMessage('tool', nudgeText(parsed.visible), 'tool')
        await addMessage(chatId, reminder)
        emit({ type: 'message', chatId, message: reminder })
        continue
      }
      return
    }

    const results: string[] = []
    if (parsed.errors.length) results.push(parsed.errors.join('\n'))
    let stopForQuestion = false
    for (const call of parsed.calls) {
      if (stopForQuestion) {
        results.push(`${call.name}: пропущен, сначала нужно учесть ответ пользователя.`)
        continue
      }
      const result = await runTool(chatId, projectPath, call, emit, signal)
      if ((call.name === 'edit_file' || call.name === 'write_file') && !/ошибка/i.test(result)) edited = true
      results.push(result)
      if (call.name === 'ask_user') stopForQuestion = true
      if (call.name === 'update_project_map') map = await ensureProjectMap(projectPath)
    }
    const toolMessage = makeMessage('tool', results.join('\n\n'), 'tool')
    await addMessage(chatId, toolMessage)
    emit({ type: 'message', chatId, message: toolMessage })
    const onlyFiles = parsed.calls.every((call) => call.name === 'write_file' || call.name === 'edit_file')
    const writeFailed = results.some((result) => /write_file ошибка/i.test(result))
    if (edited && onlyFiles && parsed.calls.some((call) => call.name === 'write_file') && !writeFailed) return
  }

  const limit = makeMessage('assistant', 'Достигнут лимит шагов. Напишите «продолжи», если задачу нужно вести дальше.', 'text')
  await addMessage(chatId, limit)
  emit({ type: 'message', chatId, message: limit })
}

export function isChatBusy(chatId: string): boolean {
  return busy.has(chatId)
}

export async function sendMessage(chatId: string, text: string, emit: (event: AgentEvent) => void): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Введите сообщение.')
  if (busy.has(chatId)) throw new Error('Этот чат уже выполняет задачу.')
  const problem = modelProblem(getSettings())
  if (problem) throw new Error(problem)
  requireChat(chatId)
  busy.add(chatId)
  const controller = new AbortController()
  controllers.set(chatId, controller)
  try {
    const userMessage = makeMessage('user', trimmed, 'text')
    await addMessage(chatId, userMessage)
    emit({ type: 'message', chatId, message: userMessage })
    await runLoop(chatId, emit, controller.signal)
  } catch (error) {
    if (isAbort(error)) {
      emit({ type: 'status', chatId, text: 'Остановлено.' })
    } else {
      const message = error instanceof Error ? error.message : String(error)
      const errorMessage = makeMessage('tool', message, 'error')
      await addMessage(chatId, errorMessage).catch(() => undefined)
      emit({ type: 'message', chatId, message: errorMessage })
      emit({ type: 'error', chatId, text: message })
    }
  } finally {
    busy.delete(chatId)
    controllers.delete(chatId)
    emit({ type: 'flush', chatId })
    emit({ type: 'status', chatId, text: '' })
    emit({ type: 'done', chatId })
  }
}

export function answerRequest(requestId: string, text: string): void {
  const waiter = waiters.get(requestId)
  if (!waiter) throw new Error('Уточнение уже закрыто.')
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Введите ответ.')
  waiter({ approved: true, text: trimmed })
}

export function decideRequest(requestId: string, approved: boolean): void {
  const waiter = waiters.get(requestId)
  if (!waiter) throw new Error('Запрос уже закрыт.')
  waiter({ approved, text: '' })
}

export function cancelChat(chatId: string): void {
  controllers.get(chatId)?.abort()
}
