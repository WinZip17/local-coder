import { useLayoutEffect, useRef, useState } from 'react'
import { displayStream } from '../../../shared/parse'
import { useThreadScroll } from '../hooks/useThreadScroll'
import { selectActivePending, useAppStore } from '../store/useAppStore'
import { MessageBubble } from './MessageBubble'

const batch = 24

export function MessageList() {
  const messages = useAppStore((state) => state.chat?.messages) ?? []
  const activeId = useAppStore((state) => state.activeId)
  const stream = useAppStore((state) => state.stream)
  const pendingId = useAppStore((state) => selectActivePending(state)?.id ?? null)
  const threadRef = useRef<HTMLDivElement>(null)
  const anchor = useRef<number | null>(null)
  const locking = useRef(false)
  const chatRef = useRef(activeId)
  const [limit, setLimit] = useState(batch)
  if (chatRef.current !== activeId) {
    chatRef.current = activeId
    anchor.current = null
    locking.current = false
    if (limit !== batch) setLimit(batch)
  }
  const streaming = displayStream(stream)
  const start = Math.max(0, messages.length - limit)
  const visible = messages.slice(start)

  useThreadScroll(threadRef, activeId, visible.length + (streaming ? 1 : 0), stream, pendingId)

  useLayoutEffect(() => {
    const node = threadRef.current
    if (!node) return
    if (anchor.current != null) {
      const previous = anchor.current
      anchor.current = null
      locking.current = true
      node.scrollTop += node.scrollHeight - previous
      requestAnimationFrame(() => {
        locking.current = false
      })
      return
    }
    if (node.clientHeight < 40) return
    if (start > 0 && node.scrollHeight <= node.clientHeight + 8) setLimit((value) => value + batch)
  }, [limit, start, activeId, messages.length])

  function revealEarlier(): void {
    const node = threadRef.current
    if (!node || locking.current || start === 0 || anchor.current != null) return
    const overflow = node.scrollHeight - node.clientHeight
    if (overflow <= 8 || node.scrollTop >= 64) return
    anchor.current = node.scrollHeight
    setLimit((value) => value + batch)
  }

  return (
    <div className="thread" ref={threadRef} onScroll={revealEarlier}>
      {visible.map((message) => <MessageBubble key={message.id} message={message} />)}
      {streaming && <article className="bubble assistant text">{streaming}</article>}
    </div>
  )
}
