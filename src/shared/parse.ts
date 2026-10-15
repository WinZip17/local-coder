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

export function parseModelOutput(text: string): { visible: string; calls: ToolCall[]; errors: string[] } {
  const calls: ToolCall[] = []
  const errors: string[] = []

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

  let visible = text.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi, (_match, body: string) => {
    consume(body)
    return ''
  })
  visible = visible.replace(/```tool\s*([\s\S]*?)```/gi, (_match, body: string) => {
    consume(body.trim())
    return ''
  })

  const loose = new RegExp(`(?:<tool_call>\\s*)?(${toolNamePattern})\\s*\\{`, 'gi')
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

  if (/<tool_call>|<\/tool_call>/i.test(visible)) {
    errors.push('Вызов инструмента оборван. Закройте блок </tool_call>.')
    visible = visible.replace(/<tool_call>[\s\S]*$/i, '').replace(/<\/tool_call>/gi, '')
  }

  return { visible: visible.trim(), calls, errors }
}

const fileRefusal = /не могу[\s\S]{0,120}(?:создавать|изменять|создать|изменить|файл)|(?:нет|не имею) доступа к файловой|текстов(?:ый|ым)\s+AI|cannot (?:create|modify|change|write|access)|can(?:not|'t) access (?:the |your )?(?:file|filesystem)|no access to (?:the |your )?(?:file|filesystem)|I(?:'m| am) (?:just )?a text/i
const fileRequest = /создай|создать|создайте|создал|добавь|добавить|измени|изменить|поменяй|переименуй|напиши|удали|исправь|вставь|перекрась|поправь|реализуй|сделай(?:те)?\s+\S{0,40}файл/i

export function shouldNudgeFileEdit(visible: string, userText: string): boolean {
  if (fileRefusal.test(visible)) return true
  if (/```/.test(visible)) return true
  return fileRequest.test(userText)
}

export function displayStream(text: string): string {
  const withoutClosed = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').replace(/```tool[\s\S]*?```/gi, '')
  const open = withoutClosed.search(/<tool_call>|```tool/i)
  return (open === -1 ? withoutClosed : withoutClosed.slice(0, open)).trim()
}
