export interface ToolCall {
  name: string
  arguments: Record<string, unknown>
}

const toolNames = ['list_dir', 'read_file', 'search_in_project', 'write_file', 'edit_file', 'update_project_map', 'run_command', 'web_search', 'ask_user']
const toolNamePattern = toolNames.join('|')

function readJsonObject(text: string, start: number): { raw: string; end: number } | null {
  if (text[start] !== '{') return null
  let depth = 0
  let inString = false
  let escape = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escape) escape = false
      else if (char === '\\') escape = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return { raw: text.slice(start, index + 1), end: index + 1 }
    }
  }
  return null
}

function asArguments(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function callFromObject(value: unknown): ToolCall | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const named = typeof record.name === 'string' ? record.name.trim().toLowerCase() : ''
  if (named && toolNames.includes(named)) {
    const nested = asArguments(record.arguments)
    if (Object.keys(nested).length) return { name: named, arguments: nested }
    const rest = { ...record }
    delete rest.name
    delete rest.arguments
    return { name: named, arguments: rest }
  }
  if (typeof record.question === 'string' && record.question.trim()) return { name: 'ask_user', arguments: { question: record.question } }
  if (typeof record.command === 'string' && record.command.trim() && Object.keys(record).every((key) => key === 'command')) {
    return { name: 'run_command', arguments: { command: record.command } }
  }
  return null
}

function parameterValue(tag: string, raw: string): unknown {
  const text = raw.trim()
  if (!/string="false"/i.test(tag)) return text
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function parseMarkupCalls(text: string): { calls: ToolCall[]; ranges: Array<[number, number]> } {
  const calls: ToolCall[] = []
  const ranges: Array<[number, number]> = []
  const invoke = /<[^\n<]*\binvoke\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/[^\n<]*\binvoke\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = invoke.exec(text))) {
    const name = match[1]?.trim().toLowerCase() ?? ''
    if (!toolNames.includes(name)) continue
    const body = match[2] ?? ''
    const args: Record<string, unknown> = {}
    const parameter = /<([^\n<]*\bparameter\b[^>]*\bname="([^"]+)"[^>]*)>([\s\S]*?)<\/[^\n<]*\bparameter\b[^>]*>/gi
    let field: RegExpExecArray | null
    while ((field = parameter.exec(body))) {
      const key = field[2]?.trim() ?? ''
      if (!key) continue
      args[key] = parameterValue(field[1] ?? '', field[3] ?? '')
    }
    calls.push({ name, arguments: args })
    ranges.push([match.index, match.index + match[0].length])
  }
  return { calls, ranges }
}

function cutRanges(text: string, ranges: Array<[number, number]>): string {
  if (!ranges.length) return text
  let cursor = 0
  let next = ''
  for (const [start, end] of ranges) {
    next += text.slice(cursor, start)
    cursor = end
  }
  return next + text.slice(cursor)
}

export function missingToolArgument(call: ToolCall): string | null {
  const text = (key: string) => typeof call.arguments[key] === 'string' ? call.arguments[key].trim() : ''
  if (call.name === 'ask_user' && !text('question')) return 'ask_user: нужен arguments.question, например {"question":"Vite или Vue?"}.'
  if (call.name === 'run_command' && !text('command')) return 'run_command: нужен arguments.command, например {"command":"npx create-vite . --template react-ts"}.'
  if (call.name === 'web_search' && !text('query')) return 'web_search: нужен arguments.query.'
  if (call.name === 'search_in_project' && !text('query')) return 'search_in_project: нужен arguments.query.'
  if ((call.name === 'read_file' || call.name === 'write_file' || call.name === 'edit_file') && !text('path')) return `${call.name}: нужен arguments.path.`
  if (call.name === 'write_file' && typeof call.arguments.content !== 'string') return 'write_file: нужен arguments.content.'
  if (call.name === 'edit_file' && !text('oldText')) return 'edit_file: нужен arguments.oldText.'
  return null
}

export function parseModelOutput(text: string): { visible: string; calls: ToolCall[]; errors: string[] } {
  const calls: ToolCall[] = []
  const errors: string[] = []
  const markup = parseMarkupCalls(text)
  calls.push(...markup.calls)
  const source = cutRanges(text, markup.ranges)

  const consume = (body: string) => {
    const trimmed = body.trim()
    try {
      const parsed = JSON.parse(trimmed) as { name?: unknown; arguments?: unknown }
      if (parsed && typeof parsed.name === 'string' && parsed.name.trim()) {
        calls.push({ name: parsed.name.trim(), arguments: asArguments(parsed.arguments) })
        return
      }
    } catch {
      // Имя иногда стоит перед JSON, а не внутри него.
    }
    const named = trimmed.match(new RegExp(`^(${toolNamePattern})\\s*`, 'i'))
    const jsonStart = named ? named[0].length : trimmed.indexOf('{')
    const json = jsonStart >= 0 ? readJsonObject(trimmed, trimmed[jsonStart] === '{' ? jsonStart : trimmed.indexOf('{', jsonStart)) : null
    if (named && json) {
      try {
        calls.push({ name: named[1].toLowerCase(), arguments: asArguments(JSON.parse(json.raw)) })
        return
      } catch {
        errors.push('Не удалось разобрать JSON инструмента.')
        return
      }
    }
    errors.push(trimmed ? 'Не удалось разобрать JSON инструмента.' : 'Вызов инструмента без имени.')
  }

  let visible = source.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi, (_match, body: string) => {
    consume(body)
    return ''
  })
  visible = visible.replace(/```tool\s*([\s\S]*?)```/gi, (_match, body: string) => {
    consume(body.trim())
    return ''
  })

  const loose = new RegExp(`(?:<tool_call>\\s*)?(${toolNamePattern})\\s*:?\\s*\\{`, 'gi')
  let looseMatch = loose.exec(visible)
  const hidden: Array<[number, number]> = []
  while (looseMatch) {
    const brace = looseMatch.index + looseMatch[0].length - 1
    const json = readJsonObject(visible, brace)
    if (json) {
      consume(`${looseMatch[1]}${json.raw}`)
      const tail = visible.slice(json.end).match(/^\s*<\/tool_call>/i)
      hidden.push([looseMatch.index, json.end + (tail?.[0].length ?? 0)])
      loose.lastIndex = json.end
    }
    looseMatch = loose.exec(visible)
  }
  if (hidden.length) {
    let cursor = 0
    let next = ''
    for (const [start, end] of hidden) {
      next += visible.slice(cursor, start)
      cursor = end
    }
    visible = next + visible.slice(cursor)
  }

  const recovered: Array<[number, number]> = []
  for (let index = 0; index < visible.length; index += 1) {
    if (visible[index] !== '{') continue
    const json = readJsonObject(visible, index)
    if (!json) continue
    try {
      const call = callFromObject(JSON.parse(json.raw) as unknown)
      if (call) {
        calls.push(call)
        recovered.push([index, json.end])
        index = json.end - 1
      }
    } catch {
      // обычный текст с фигурной скобкой не является вызовом
    }
  }
  if (recovered.length) {
    let cursor = 0
    let next = ''
    for (const [start, end] of recovered) {
      next += visible.slice(cursor, start)
      cursor = end
    }
    visible = next + visible.slice(cursor)
  }

  if (/<tool_call>|<\/tool_call>/i.test(visible)) {
    errors.push('Вызов инструмента оборван. Закройте блок </tool_call>.')
    visible = visible.replace(/<tool_call>[\s\S]*$/i, '').replace(/<\/tool_call>/gi, '')
  }

  visible = visible.replace(/<[^\n<]*\b(?:tool_calls|calls)\b[^>]*>/gi, '').replace(/<\/[^\n<]*\b(?:tool_calls|calls)\b[^>]*>/gi, '')
  return { visible: visible.trim(), calls, errors }
}

const fileRefusal = /не могу[\s\S]{0,120}(?:создавать|изменять|создать|изменить|файл)|(?:нет|не имею) доступа к файловой|текстов(?:ый|ым)\s+AI|cannot (?:create|modify|change|write|access)|can(?:not|'t) access (?:the |your )?(?:file|filesystem)|no access to (?:the |your )?(?:file|filesystem)|I(?:'m| am) (?:just )?a text/i
const fileRequest = /создай|создать|создайте|создал|добавь|добавить|измени|изменить|поменяй|переименуй|напиши|удали|исправь|вставь|перекрась|поправь|реализуй|сделай(?:те)?\s+\S{0,40}файл/i
const nothingToChange = /не существует|отсутствует|не найден|нет такой|нечего (?:удалять|менять|изменять)|уже (?:нет|отсутствует)|does not exist|doesn't exist|not found|nothing to (?:delete|change|edit)/i

export function shouldNudgeFileEdit(visible: string, userText: string, nudges = 0): boolean {
  if (nothingToChange.test(visible) && !/```/.test(visible)) return false
  if (nudges >= 2) return false
  if (fileRefusal.test(visible)) return true
  if (/```/.test(visible)) return true
  if (nudges >= 1) return false
  return fileRequest.test(userText)
}

export function displayStream(text: string): string {
  const withoutMarkup = cutRanges(text, parseMarkupCalls(text).ranges)
  const withoutClosed = withoutMarkup.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').replace(/```tool[\s\S]*?```/gi, '')
  const open = withoutClosed.search(/<tool_call>|```tool|<[^>\n]*\binvoke\b/i)
  return (open === -1 ? withoutClosed : withoutClosed.slice(0, open)).trim()
}
