import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

export function useThreadScroll(
  ref: RefObject<HTMLDivElement | null>,
  activeId: string | null,
  messageCount: number,
  stream: string,
  pendingId: string | null
): void {
  const stick = useRef(true)
  const chatRef = useRef(activeId)
  if (chatRef.current !== activeId) {
    chatRef.current = activeId
    stick.current = true
  }

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const onScroll = () => {
      stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 96
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [ref, activeId])

  useLayoutEffect(() => {
    const node = ref.current
    if (!node || !stick.current) return
    node.scrollTop = node.scrollHeight
  }, [ref, messageCount, stream, pendingId])
}
