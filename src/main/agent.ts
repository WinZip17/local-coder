import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { commandAlreadySucceeded, commandFailed, commandFromCreationAnswer, creationQuestion, dependenciesInstalled, generatorSucceeded, isCreateReactApp, isDevServerCommand, isDirectoryChange, isInstallCommand, isProjectCreationRequest, normalizeCommand, removesLocalCoder, scaffoldInCurrentFolder, unfinishedPackageInstall } from '../shared/creation'
import { declaresFinished, impliedToolCall, listedDirectory, pendingEditPath, statesPendingWork, toolAfterSilence } from '../shared/intent'
import { hoistScaffold } from './hoistScaffold'
import { pathCommentFile, clipToFirstCommand, componentSnippet, describedLineEdit, describedSnippets, hasUnclosedFence, replacementContent, shellCommand, snippetToEdit } from '../shared/edits'
import type { ToolCall } from '../shared/parse'
import { missingToolArgument, parseModelOutput, shouldNudgeFileEdit } from '../shared/parse'
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

function lastToolText(chatId: string): string {
  const messages = requireChat(chatId).messages
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'tool') return messages[index]?.content ?? ''
  }
  return ''
}

function installIsBroken(chatId: string): boolean {
  let broken = false
  for (const message of requireChat(chatId).messages) {
    if (message.role !== 'tool' || !isInstallCommand(message.content)) continue
    broken = commandFailed(message.content)
  }
  return broken
}

function projectWasGenerated(chatId: string): boolean {
  return requireChat(chatId).messages.some((message) => message.role === 'tool' && generatorSucceeded(message.content))
}

function lastReadPage(chatId: string): string {
  const messages = requireChat(chatId).messages
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'tool') continue
    const match = message.content.match(/(?:^|\n\n)read_file\s+([^\s:]+)/)
    const file = match?.[1]?.replace(/\\/g, '/') ?? ''
    if (/(?:^|\/)(?:App|page)\.(?:tsx|jsx)$/i.test(file) || /(?:^|\/)app\.vue$/i.test(file)) return file
  }
  return ''
}

function pageWrittenSinceScaffold(chatId: string, filePath: string): boolean {
  const messages = requireChat(chatId).messages
  let generatedAt = -1
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message?.role === 'tool' && generatorSucceeded(message.content)) generatedAt = index
  }
  if (generatedAt < 0 || !filePath) return false
  const escaped = filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:^|\\n\\n)(?:write_file|edit_file) ${escaped}(?::|\\s)`, 'i')
  return messages.slice(generatedAt + 1).some((message) => message.role === 'tool' && pattern.test(message.content) && /записано|заменено/i.test(message.content))
}

function filesWereEdited(chatId: string): boolean {
  return requireChat(chatId).messages.some((message) => message.role === 'tool' && /(?:^|\n\n)(?:write_file|edit_file) \S[^\n]*(?:записано|заменено)/i.test(message.content))
}

function successfulCommands(chatId: string): string[] {
  return requireChat(chatId).messages.filter((message) => message.role === 'tool').map((message) => message.content)
}

function userAskedToRepeat(chatId: string): boolean {
  return /ещё раз|еще раз|повтор(?:и|ите|ить)|заново|снова запусти|запусти снова|перезапусти/i.test(lastUserText(chatId))
}

function stalledAfterDuplicate(chatId: string): boolean {
  const messages = requireChat(chatId).messages
  const start = Math.max(0, messages.length - 8)
  for (let index = messages.length - 1; index >= start; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'tool') continue
    if (/(?:^|\n\n)(?:write_file|edit_file) \S[^\n]*(?:записано|заменено)/i.test(message.content)) return false
    if (/Повторно не запускаю/.test(message.content)) return true
  }
  return false
}

function projectInstallCommand(chatId: string): string {
  for (let index = requireChat(chatId).messages.length - 1; index >= 0; index -= 1) {
    const message = requireChat(chatId).messages[index]
    if (!message || message.role !== 'tool' || !generatorSucceeded(message.content)) continue
    const command = message.content.match(/(?:^|\n\n)run_command ([^\n]+)/)?.[1] ?? ''
    if (/^pnpm\b/i.test(command)) return 'pnpm install'
    if (/^yarn\b/i.test(command)) return 'yarn install'
    if (/^bun\b/i.test(command)) return 'bun install'
    return 'npm install'
  }
  return 'npm install'
}

function chatCreatesProject(chatId: string): boolean {
  return requireChat(chatId).messages.some((message) => message.role === 'user' && isProjectCreationRequest(message.content))
}

function taskNeedsStages(chatId: string): boolean {
  return requireChat(chatId).messages.some((message) => message.role === 'user' && /поэтап|план разработ|карту проекта|между каждыми этапами/i.test(message.content))
}

function lastCreationChoice(chatId: string): { question: string; answer: string } | null {
  for (let index = requireChat(chatId).messages.length - 1; index >= 0; index -= 1) {
    const message = requireChat(chatId).messages[index]
    if (!message || message.role !== 'tool' || !message.content.startsWith('ask_user') || !/Ответ пользователя:/.test(message.content)) continue
    const question = message.content.match(/Вопрос:\s*([\s\S]*?)\nОтвет пользователя:/)?.[1]?.trim() ?? ''
    const answer = message.content.match(/Ответ пользователя:\s*([\s\S]*)$/)?.[1]?.trim() ?? ''
    if (question && answer) return { question, answer }
  }
  return null
}

function creationChoiceAnswered(chatId: string): boolean {
  return requireChat(chatId).messages.some((message) => message.role === 'tool' && message.content.startsWith('ask_user') && /Ответ пользователя:/.test(message.content))
}

function creationAllowsFiles(chatId: string): boolean {
  if (!isProjectCreationRequest(lastUserText(chatId))) return true
  return requireChat(chatId).messages.some((message) => {
    if (message.role !== 'tool') return false
    if (message.content.startsWith('ask_user') && /Ответ пользователя:/.test(message.content)) return true
    return /create-|nuxi|npm create|pnpm create|yarn create/i.test(message.content) && /Процесс завершился с кодом 0/.test(message.content)
  })
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

async function editsFromAnswer(projectPath: string, visible: string, userText: string, pagePath = ''): Promise<ToolCall[]> {
  const calls: ToolCall[] = []
  for (const item of describedSnippets(visible, userText)) {
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
    const replaced = replacementContent(userText, item.path, item.snippet, fileText)
    if (replaced) {
      calls.push({ name: 'write_file', arguments: { path: item.path, content: replaced } })
      continue
    }
    const edit = snippetToEdit(fileText, item.snippet)
    if (!edit) {
      if (isProjectCreationRequest(userText) && /export default/.test(item.snippet) && item.snippet.split('\n').length >= 8) {
        calls.push({
          name: 'write_file',
          arguments: { path: item.path, content: item.snippet.endsWith('\n') ? item.snippet : `${item.snippet}\n` }
        })
      }
      continue
    }
    calls.push({
      name: 'edit_file',
      arguments: { path: item.path, oldText: edit.oldText, newText: edit.newText }
    })
  }
  if (!calls.length) {
    const line = describedLineEdit(await sourceFiles(projectPath), userText, visible)
    if (line) calls.push({ name: 'edit_file', arguments: { path: line.path, oldText: line.oldText, newText: line.newText } })
  }
  if (pagePath && !calls.some((call) => call.arguments.path === pagePath)) {
    const body = componentSnippet(visible)
    if (body) {
      let current = ''
      try {
        current = await readFile(resolveInsideProject(projectPath, pagePath), 'utf8')
      } catch {
        current = ''
      }
      if (current.replace(/\r\n/g, '\n').trim() !== body.trim()) {
        calls.push({ name: 'write_file', arguments: { path: pagePath, content: body } })
      }
    }
  }
  const loose = pathCommentFile(visible)
  if (loose && !calls.some((call) => call.arguments.path === loose.path)) {
    let current = ''
    try {
      current = await readFile(resolveInsideProject(projectPath, loose.path), 'utf8')
    } catch {
      current = ''
    }
    if (current.replace(/\r\n/g, '\n').trim() !== loose.snippet.trim()) {
      calls.push({ name: 'write_file', arguments: { path: loose.path, content: loose.snippet } })
    }
  }
  return calls
}

async function runTool(chatId: string, projectPath: string, call: ToolCall, emit: (event: AgentEvent) => void, signal: AbortSignal): Promise<string> {
  const missing = missingToolArgument(call)
  if (missing) return missing
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
  let failureNudges = 0
  let emptyToolSteps = 0
  let adjustNudges = 0
  let intentNudges = 0
  let emptyAnswers = 0
  let cutNudges = 0
  let packageNudges = 0
  let stallNudges = 0
  let planStopNudges = 0
  let echoNudges = 0
  let stepLimit = taskNeedsStages(chatId) ? 24 : chatCreatesProject(chatId) ? 12 : MAX_STEPS
  const hardLimit = stepLimit + 4
  let cutoff = true
  const doneCommands = new Set<string>()

  for (let step = 1; step <= hardLimit; step += 1) {
    if (signal.aborted) throw new DOMException('Остановлено', 'AbortError')
    emit({ type: 'status', chatId, text: `Шаг ${step} из ${stepLimit}` })
    const settings = getSettings()
    const problem = modelProblem(settings)
    if (problem) throw new Error(problem)
    const pendingPackages = unfinishedPackageInstall(requireChat(chatId).messages)
    if (pendingPackages && packageNudges < 2) {
      packageNudges += 1
      const reminder = makeMessage('tool', `Пакеты из этапа не установлены: вместо них выполнился npm install. Следующим ответом вызови только эту команду: ${pendingPackages}. Следующий этап не начинай.`, 'tool')
      await addMessage(chatId, reminder)
      emit({ type: 'message', chatId, message: reminder })
    }
    if (!pendingPackages && stallNudges < 3 && taskNeedsStages(chatId) && stalledAfterDuplicate(chatId)) {
      stallNudges += 1
      const reminder = makeMessage('tool', 'Эта команда уже выполнена. Не повторяй её и не вызывай только update_project_map. Следующим ответом вызови write_file и запиши один следующий файл страницы.', 'tool')
      await addMessage(chatId, reminder)
      emit({ type: 'message', chatId, message: reminder })
    }
    const contextSize = settings.activeProvider === 'local' ? settings.local.contextSize : 8192
    const early = new AbortController()
    const followParent = () => early.abort()
    signal.addEventListener('abort', followParent)
    let streamed = ''
    let output = ''
    let emptyAnswer = false
    let commandSeen = false
    try {
      output = await completeChat({
        settings,
        messages: [{ role: 'system', content: buildSystemPrompt(projectPath, map, contextSize) }, ...transcript(chatId)],
        onToken: (text) => {
          if (commandSeen) return
          const next = streamed + text
          const clipped = clipToFirstCommand(next)
          const piece = clipped.startsWith(streamed) ? clipped.slice(streamed.length) : clipped
          streamed = clipped
          if (piece) emit({ type: 'token', chatId, text: piece })
          if (shellCommand(clipped)) {
            commandSeen = true
            if (!signal.aborted) early.abort()
          }
        },
        onStatus: (text) => emit({ type: 'status', chatId, text }),
        signal: early.signal
      })
    } catch (error) {
      if (signal.aborted) throw error
      if (commandSeen && shellCommand(streamed)) output = streamed
      else {
        const message = error instanceof Error ? error.message : String(error)
        if (!/пустой ответ/.test(message)) throw error
        emit({ type: 'flush', chatId })
        emptyAnswer = true
        output = ''
      }
    } finally {
      signal.removeEventListener('abort', followParent)
    }
    emit({ type: 'flush', chatId })
    const parsed = parseModelOutput(clipToFirstCommand(output || streamed))
    const creating = chatCreatesProject(chatId)
    if (creating && !parsed.calls.length && !parsed.errors.length && !projectWasGenerated(chatId)) {
      const choice = lastCreationChoice(chatId)
      const command = choice ? commandFromCreationAnswer(choice.question, choice.answer) : null
      if (command) parsed.calls.push({ name: 'run_command', arguments: { command } })
    }
    if (parsed.visible && sameText(parsed.visible, previousAssistant(chatId)) && !parsed.calls.length) return
    const shownCommand = parsed.calls.some((call) => call.name === 'run_command') ? null : shellCommand(parsed.visible)
    if (shownCommand) {
      parsed.calls = parsed.calls.filter((call) => call.name === 'run_command')
      parsed.calls.push({ name: 'run_command', arguments: { command: shownCommand } })
    }
    const alreadyWrites = parsed.calls.some((call) => call.name === 'edit_file' || call.name === 'write_file')
    let deferredFiles = 0
    let wroteThisStep = false
    const generatorShown = Boolean(shownCommand && /create-next-app|create-vite|create-react-app|create-vue|nuxi/i.test(shownCommand))
    if (!generatorShown && !alreadyWrites && parsed.visible && creationAllowsFiles(chatId)) {
      const candidate = creating && projectWasGenerated(chatId) ? lastReadPage(chatId) : ''
      const pagePath = candidate && !pageWrittenSinceScaffold(chatId, candidate) ? candidate : ''
      const extracted = await editsFromAnswer(projectPath, parsed.visible, lastUserText(chatId), pagePath)
      const files = extracted.filter((call) => call.name === 'write_file' || call.name === 'edit_file')
      deferredFiles = Math.max(0, files.length - 1)
      const first = files[0]
      if (first) parsed.calls.push(first)
    }
    if (parsed.visible) {
      const message = makeMessage('assistant', parsed.visible, 'text')
      await addMessage(chatId, message)
      emit({ type: 'message', chatId, message })
    }
    if (!parsed.calls.length && !parsed.errors.length) {
      const implied = impliedToolCall(parsed.visible)
      const previous = lastToolText(chatId)
      const listed = previous.match(/^list_dir\s+(\S+)/)
      const repeated = implied?.name === 'list_dir' && listed?.[1] === implied.arguments.path
      if (implied && !repeated) parsed.calls.push(implied)
    }
    if (!parsed.calls.length && !parsed.errors.length && /update_project_map/i.test(parsed.visible) && /только update_project_map/.test(lastToolText(chatId))) {
      parsed.calls.push({ name: 'update_project_map', arguments: { summary: 'Этап выполнен.', notes: ['Команда этапа завершилась успешно'] } })
    }
    if (emptyAnswer && !parsed.calls.length && !parsed.errors.length) {
      const previous = lastToolText(chatId)
      const silent = toolAfterSilence(previous)
      const listed = previous.match(/^list_dir\s+(\S+)/)
      const repeated = silent?.name === 'list_dir' && listed?.[1] === silent.arguments.path
      if (silent && !repeated) parsed.calls.push(silent)
      else if (creating && projectWasGenerated(chatId) && !edited && !listed && !previous.startsWith('read_file')) {
        parsed.calls.push({ name: 'list_dir', arguments: { path: '.' } })
      }
    }
    if (creating && !parsed.calls.length && !parsed.errors.length && !projectWasGenerated(chatId) && !creationChoiceAnswered(chatId)) {
      const question = creationQuestion(lastUserText(chatId), parsed.visible)
      if (question) parsed.calls.push({ name: 'ask_user', arguments: { question } })
    }
    if (!parsed.calls.length && !parsed.errors.length) {
      if (step < stepLimit && failureNudges < 3 && commandFailed(lastToolText(chatId))) {
        failureNudges += 1
        const missingPackages = /ERR_MODULE_NOT_FOUND|Cannot find package|Cannot find module|зациклил/i.test(lastToolText(chatId))
        const craBlocked = /create-react-app|could conflict|\.local-coder/i.test(lastToolText(chatId))
        const reminder = makeMessage('tool', missingPackages
          ? 'Пакеты проекта не установлены. Вызови run_command только с npm install и дождись кода 0. Не запускай npm run dev, не ставь пакеты по одному и не меняй vite.config.'
          : craBlocked
            ? 'Папку .local-coder удалять нельзя. create-react-app рядом с ней не запускается. Вызови npx create-vite@latest . --template react-ts --overwrite.'
            : 'Команда завершилась с ошибкой. Исправь причину в файлах или другой командой и запусти её снова. Не заканчивай задачу пересказом ошибки.', 'tool')
        await addMessage(chatId, reminder)
        emit({ type: 'message', chatId, message: reminder })
        continue
      }
      if (!taskNeedsStages(chatId) && creating && projectWasGenerated(chatId) && !edited && !filesWereEdited(chatId) && step < stepLimit && adjustNudges < 2) {
        adjustNudges += 1
        const reminder = makeMessage('tool', 'Шаблон генератора ещё не изменён. Пересказ правок файл не меняет. Вызови list_dir, найди главный файл страницы и вызови write_file по этому пути, например src/App.tsx или src/App.jsx. Передай полный новый текст: только то, что просил пользователь. Демо-блоки шаблона удали. Не придумывай путь с именем папки проекта.', 'tool')
        await addMessage(chatId, reminder)
        emit({ type: 'message', chatId, message: reminder })
        continue
      }
      if (intentNudges < 4 && statesPendingWork(parsed.visible)) {
        intentNudges += 1
        if (step >= stepLimit && stepLimit < hardLimit) stepLimit += 1
        const editPath = pendingEditPath(parsed.visible) ?? ( /замен|перепиш|измен|обновл|впишу|запиш|write_file|edit_file/i.test(parsed.visible) ? lastToolText(chatId).match(/^read_file\s+(\S+)/)?.[1] ?? '' : '')
        const text = editPath
          ? `Замена без записи файл не меняет. Сразу вызови write_file для ${editPath} и передай в content полный новый текст файла. Не описывай замену словами.`
          : 'Описание следующего шага ничего не выполняет. Сразу вызови нужный инструмент в этом ответе: list_dir, read_file, write_file, edit_file или run_command. Не пиши, что сделаешь это потом.'
        const reminder = makeMessage('tool', text, 'tool')
        await addMessage(chatId, reminder)
        emit({ type: 'message', chatId, message: reminder })
        continue
      }
      if (emptyAnswer && emptyAnswers < 2) {
        emptyAnswers += 1
        const previous = lastToolText(chatId)
        const text = /за концом/.test(previous)
          ? 'Ответ пустой. Прочитай файл с offset 1 и вызови edit_file с точным фрагментом.'
          : /^read_file /.test(previous)
            ? 'Ответ пустой. Файл уже прочитан. Вызови write_file и передай полный новый текст.'
            : 'Ответ пустой. Продолжи задачу вызовом инструмента.'
        const reminder = makeMessage('tool', text, 'tool')
        await addMessage(chatId, reminder)
        emit({ type: 'message', chatId, message: reminder })
        continue
      }
      if (emptyAnswer) {
        const stop = makeMessage('assistant', 'Модель повторно вернула пустой ответ. Файлы на этом шаге не изменены. Напишите «продолжи».', 'text')
        await addMessage(chatId, stop)
        emit({ type: 'message', chatId, message: stop })
        return
      }
      if (!creating && !edited && step < stepLimit && shouldNudgeFileEdit(parsed.visible, lastUserText(chatId), nudges)) {
        nudges += 1
        const reminder = makeMessage('tool', nudgeText(parsed.visible), 'tool')
        await addMessage(chatId, reminder)
        emit({ type: 'message', chatId, message: reminder })
        continue
      }
      if (cutNudges < 3 && step < stepLimit && hasUnclosedFence(parsed.visible)) {
        cutNudges += 1
        const reminder = makeMessage('tool', 'Ответ оборвался на незаконченном файле. Следующим ответом вызови write_file для одного полного файла. Остальные файлы в этот ответ не копируй.', 'tool')
        await addMessage(chatId, reminder)
        emit({ type: 'message', chatId, message: reminder })
        continue
      }
      if (echoNudges < 4 && /^update_project_map\b/i.test(parsed.visible.trim()) && /update_project_map:/.test(lastToolText(chatId))) {
        echoNudges += 1
        const reminder = makeMessage('tool', 'Карта уже обновлена. Следующим ответом выполни следующий пункт плана: одна команда или один файл. update_project_map повторно не вызывай.', 'tool')
        await addMessage(chatId, reminder)
        emit({ type: 'message', chatId, message: reminder })
        continue
      }
      cutoff = statesPendingWork(parsed.visible)
      if (!cutoff && stallNudges < 3 && taskNeedsStages(chatId) && stalledAfterDuplicate(chatId)) {
        stallNudges += 1
        const reminder = makeMessage('tool', 'Этап не закончен. Команда уже выполнена, пересказ её не продолжает. Следующим ответом вызови write_file и запиши один следующий файл страницы.', 'tool')
        await addMessage(chatId, reminder)
        emit({ type: 'message', chatId, message: reminder })
        continue
      }
      if (!cutoff && planStopNudges < 2 && taskNeedsStages(chatId) && step < hardLimit) {
        planStopNudges += 1
        const reminder = makeMessage('tool', 'План ещё не закончен. Следующим ответом продолжи следующий пункт: одна команда или один write_file, затем update_project_map.', 'tool')
        await addMessage(chatId, reminder)
        emit({ type: 'message', chatId, message: reminder })
        continue
      }
      break
    }

    if (creating && !projectWasGenerated(chatId) && !creationChoiceAnswered(chatId)) {
      const question = creationQuestion(lastUserText(chatId), parsed.visible)
      if (question) {
        let filled = false
        parsed.calls = parsed.calls.filter((call) => {
          if (call.name !== 'ask_user' || String(call.arguments.question ?? '').trim()) return true
          if (filled) return false
          call.arguments = { ...call.arguments, question }
          filled = true
          return true
        })
      }
    }
    if (creating && !projectWasGenerated(chatId)) {
      const choice = lastCreationChoice(chatId)
      const chosen = choice ? commandFromCreationAnswer(choice.question, choice.answer) : null
      if (chosen) {
        let filled = false
        parsed.calls = parsed.calls.filter((call) => {
          if (call.name !== 'run_command' || String(call.arguments.command ?? '').trim()) return true
          if (filled) return false
          call.arguments = { ...call.arguments, command: chosen }
          filled = true
          return true
        })
      }
    }
    const results: string[] = []
    if (parsed.errors.length) results.push(parsed.errors.join('\n'))
    const incomplete = parsed.calls.length > 0 && parsed.calls.every((call) => missingToolArgument(call))
    emptyToolSteps = incomplete ? emptyToolSteps + 1 : 0
    let installBroken = installIsBroken(chatId)
    let stopForQuestion = false
    let ranNewCommand = false
    for (const call of parsed.calls) {
      if (stopForQuestion) {
        results.push(`${call.name}: пропущен, сначала нужно учесть ответ пользователя.`)
        continue
      }
      if (call.name === 'list_dir') {
        const current = typeof call.arguments.path === 'string' ? call.arguments.path.trim() : ''
        const listed = listedDirectory(parsed.visible)
        if (listed && (current === '' || current === '.' || current === './')) call.arguments = { ...call.arguments, path: listed }
      }
      if (call.name === 'run_command') {
        const original = typeof call.arguments.command === 'string' ? call.arguments.command.trim() : ''
        if (isDirectoryChange(original)) {
          results.push('run_command отклонён: папка проекта уже выбрана. cd не переносит следующие команды, работай в текущей папке.')
          continue
        }
        const placed = scaffoldInCurrentFolder(original)
        if (placed && placed !== original) call.arguments = { ...call.arguments, command: placed }
        let command = typeof call.arguments.command === 'string' ? call.arguments.command : original
        if (removesLocalCoder(command)) {
          results.push('run_command отклонён: папку .local-coder удалять нельзя, это служебная папка. Для Next.js вызови npx create-next-app@latest . --ts --no-tailwind --eslint --app --src-dir --use-npm --import-alias "@/*". Для React вызови npx create-vite@latest . --template react-ts --overwrite.')
          continue
        }
        if (isCreateReactApp(command)) {
          results.push('run_command отклонён: create-react-app не создаёт проект рядом с .local-coder. Папку не удаляй. Вызови npx create-vite@latest . --template react-ts --overwrite или --template react для JavaScript.')
          continue
        }
        const installed = dependenciesInstalled(requireChat(chatId).messages.filter((message) => message.role === 'tool').map((message) => message.content))
        if (!installed && isDevServerCommand(command)) {
          if (installBroken && isDevServerCommand(command)) {
            results.push('run_command пропущен: установка зависимостей завершилась с ошибкой. Сначала исправь её, npm run dev не запускай.')
            continue
          }
          command = projectInstallCommand(chatId)
          call.arguments = { ...call.arguments, command }
        }
        if (installBroken && isDevServerCommand(command)) {
          results.push('run_command пропущен: установка зависимостей завершилась с ошибкой. Сначала исправь её, npm run dev не запускай.')
          continue
        }
        const key = normalizeCommand(command)
        if (key && !userAskedToRepeat(chatId) && (doneCommands.has(key) || commandAlreadySucceeded(successfulCommands(chatId), key))) {
          results.push(`run_command ${key}\nЭта команда уже завершилась с кодом 0. Повторно не запускаю. Следующим ответом вызови write_file для одного следующего файла. Эту команду не повторяй.`)
          continue
        }
      }
      let result = await runTool(chatId, projectPath, call, emit, signal)
      if (call.name === 'run_command') {
        const command = typeof call.arguments.command === 'string' ? call.arguments.command : ''
        ranNewCommand = true
        if (/Процесс завершился с кодом 0/.test(result) && !commandFailed(result)) doneCommands.add(normalizeCommand(command))
        if (isInstallCommand(command)) installBroken = commandFailed(result)
        if (generatorSucceeded(result)) {
          const lifted = await hoistScaffold(projectPath).catch(() => null)
          if (lifted) result += `\n${lifted}`
        }
      }
      if ((call.name === 'edit_file' || call.name === 'write_file') && !/ошибка/i.test(result)) {
        edited = true
        wroteThisStep = true
      }
      results.push(result)
      if (call.name === 'ask_user') stopForQuestion = true
      if (call.name === 'update_project_map') map = await ensureProjectMap(projectPath)
    }
    const toolMessage = makeMessage('tool', results.join('\n\n'), 'tool')
    await addMessage(chatId, toolMessage)
    emit({ type: 'message', chatId, message: toolMessage })
    const staged = taskNeedsStages(chatId)
    if (wroteThisStep && (deferredFiles > 0 || staged) && !parsed.calls.some((call) => call.name === 'update_project_map') && step < hardLimit) {
      const reminder = makeMessage('tool', 'За этот ход записан один файл. Следующим ответом вызови только update_project_map. Следующий пункт плана начнётся после карты.', 'tool')
      await addMessage(chatId, reminder)
      emit({ type: 'message', chatId, message: reminder })
    }
    const ranFreshCommand = ranNewCommand && results.some((result) => /run_command/.test(result) && /Процесс завершился с кодом 0/.test(result) && !/Повторно не запускаю/.test(result))
    if (staged && ranFreshCommand && !wroteThisStep && !parsed.calls.some((call) => call.name === 'update_project_map') && step < hardLimit) {
      const reminder = makeMessage('tool', 'Команда этапа выполнена. Следующим ответом вызови только update_project_map. Новую команду и файлы в этот ответ не добавляй.', 'tool')
      await addMessage(chatId, reminder)
      emit({ type: 'message', chatId, message: reminder })
    }
    if (emptyToolSteps >= 2) {
      const saved = !creating || filesWereEdited(chatId) || projectWasGenerated(chatId)
      const stop = makeMessage('assistant', saved
        ? 'Модель повторила вызов без аргументов. Сделанные изменения на месте. Напишите «продолжи», если нужно вести задачу дальше.'
        : 'Модель повторяет вызов инструмента без аргументов. Напишите задачу ещё раз.', 'text')
      await addMessage(chatId, stop)
      emit({ type: 'message', chatId, message: stop })
      return
    }
    const failedNow = results.some((result) => commandFailed(result) || /ошибка/i.test(result))
    if (deferredFiles === 0 && declaresFinished(parsed.visible) && !statesPendingWork(parsed.visible) && !failedNow && !stalledAfterDuplicate(chatId)) {
      if (!ranNewCommand) return
      cutoff = false
    }
    const onlyFiles = parsed.calls.every((call) => call.name === 'write_file' || call.name === 'edit_file')
    const writeFailed = results.some((result) => /write_file ошибка/i.test(result))
    const stagedNow = taskNeedsStages(chatId)
    if (!creating && !stagedNow && edited && onlyFiles && parsed.calls.some((call) => call.name === 'write_file') && !writeFailed) return
  }

  if (!cutoff) return
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
