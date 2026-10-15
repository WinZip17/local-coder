import { useEffect, type RefObject } from 'react'

export function useThreadScroll(
  ref: RefObject<HTMLDivElement | null>,
  messageCount: number,
  stream: string,
  pendingId: string | null
) {
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight })
  }, [ref, messageCount, stream, pendingId])
}
