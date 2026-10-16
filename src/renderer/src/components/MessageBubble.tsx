import { useState } from 'react'
import type { ChatMessage } from '../../../shared/types'

export function MessageBubble({ message }: { message: ChatMessage }) {
  const stamp = formatStamp(message.createdAt)
  const tool = message.role === 'tool' || message.kind === 'tool'
  return (
    <div className={`message ${message.role}`}>
      {tool ? <ToolBubble message={message} /> : (
        <article className={`bubble ${message.role} ${message.kind}`}>{message.content}</article>
      )}
      {stamp && <time dateTime={message.createdAt}>{stamp}</time>}
    </div>
  )
}

function ToolBubble({ message }: { message: ChatMessage }) {
  const lines = message.content.split('\n')
  const long = lines.length > 3
  const [open, setOpen] = useState(!long)
  const title = lines.find((line) => line.trim())?.trim() || 'Инструмент'
  const preview = title.length > 88 ? `${title.slice(0, 88)}…` : title
  return (
    <article className={`bubble tool ${message.kind}`}>
      <button
        type="button"
        className="spoiler-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Свернуть' : preview}
        {!open && long ? ` · ${lineLabel(lines.length)}` : ''}
      </button>
      {open && <div className="spoiler-body">{message.content}</div>}
    </article>
  )
}

function lineLabel(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} строка`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} строки`
  return `${count} строк`
}

function formatStamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}
