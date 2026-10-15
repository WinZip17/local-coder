export interface ToolCall {
  name: string
  arguments: Record<string, unknown>
}

export function parseModelOutput(text: string): { visible: string; calls: ToolCall[]; errors: string[] } {
  const calls: ToolCall[] = []
  const errors: string[] = []

  const consume = (body: string) => {
    try {
      const parsed = JSON.parse(body) as { name?: unknown; arguments?: unknown }
      if (!parsed || typeof parsed.name !== 'string' || !parsed.name.trim()) {
        errors.push('Вызов инструмента без имени.')
        return
      }
      const args = parsed.arguments
      calls.push({
        name: parsed.name.trim(),
        arguments: args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
      })
    } catch {
      errors.push('Не удалось разобрать JSON инструмента.')
    }
  }

  let visible = text.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi, (_match, body: string) => {
    consume(body)
    return ''
  })
  visible = visible.replace(/```tool\s*([\s\S]*?)```/gi, (_match, body: string) => {
    consume(body.trim())
    return ''
  })

  if (/<tool_call>/i.test(visible)) {
    errors.push('Вызов инструмента оборван. Закройте блок </tool_call>.')
    visible = visible.replace(/<tool_call>[\s\S]*$/i, '')
  }

  return { visible: visible.trim(), calls, errors }
}

export function displayStream(text: string): string {
  const withoutClosed = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').replace(/```tool[\s\S]*?```/gi, '')
  const open = withoutClosed.search(/<tool_call>|```tool/i)
  return (open === -1 ? withoutClosed : withoutClosed.slice(0, open)).trim()
}
