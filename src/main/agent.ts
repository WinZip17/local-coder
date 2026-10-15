import type { ToolCall } from '../shared/parse'
import { parseModelOutput } from '../shared/parse'
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

  for (let step = 1; step <= MAX_STEPS; step += 1) {
    if (signal.aborted) throw new DOMException('Остановлено', 'AbortError')
    emit({ type: 'status', chatId, text: `Шаг ${step} из ${MAX_STEPS}` })
    const settings = getSettings()
    const problem = modelProblem(settings)
    if (problem) throw new Error(problem)
    let streamed = ''
    const output = await completeChat({
      settings,
      messages: [{ role: 'system', content: buildSystemPrompt(projectPath, map) }, ...transcript(chatId)],
      onToken: (text) => {
        streamed += text
        emit({ type: 'token', chatId, text })
      },
      onStatus: (text) => emit({ type: 'status', chatId, text }),
      signal
    })
    emit({ type: 'flush', chatId })
    const parsed = parseModelOutput(output || streamed)
    if (parsed.visible) {
      const message = makeMessage('assistant', parsed.visible, 'text')
      await addMessage(chatId, message)
      emit({ type: 'message', chatId, message })
    }
    if (!parsed.calls.length && !parsed.errors.length) return

    const results: string[] = []
    if (parsed.errors.length) results.push(parsed.errors.join('\n'))
    let stopForQuestion = false
    for (const call of parsed.calls) {
      if (stopForQuestion) {
        results.push(`${call.name}: пропущен, сначала нужно учесть ответ пользователя.`)
        continue
      }
      const result = await runTool(chatId, projectPath, call, emit, signal)
      results.push(result)
      if (call.name === 'ask_user') stopForQuestion = true
      if (call.name === 'update_project_map') map = await ensureProjectMap(projectPath)
    }
    const toolMessage = makeMessage('tool', results.join('\n\n'), 'tool')
    await addMessage(chatId, toolMessage)
    emit({ type: 'message', chatId, message: toolMessage })
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
