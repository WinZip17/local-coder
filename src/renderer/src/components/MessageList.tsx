import { useRef } from 'react'
import { displayStream } from '../../../shared/parse'
import { useThreadScroll } from '../hooks/useThreadScroll'
import { selectActivePending, useAppStore } from '../store/useAppStore'

export function MessageList() {
  const messages = useAppStore((state) => state.chat?.messages)
  const stream = useAppStore((state) => state.stream)
  const pendingId = useAppStore((state) => selectActivePending(state)?.id ?? null)
  const threadRef = useRef<HTMLDivElement>(null)
  const streaming = displayStream(stream)
  useThreadScroll(threadRef, messages?.length ?? 0, stream, pendingId)

  return (
    <div className="thread" ref={threadRef}>
      {messages?.map((message) => (
        <article key={message.id} className={`bubble ${message.role} ${message.kind}`}>
          {message.content}
        </article>
      ))}
      {streaming && <article className="bubble assistant text">{streaming}</article>}
    </div>
  )
}
