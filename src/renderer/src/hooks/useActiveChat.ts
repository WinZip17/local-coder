import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'

export function useActiveChat() {
  const activeId = useAppStore((state) => state.activeId)

  useEffect(() => {
    let cancel = false
    const store = useAppStore.getState()
    store.beginChatSwitch(activeId)
    if (!activeId) return
    const chatId = activeId
    void window.localCoder.getChat(chatId).then((result) => {
      if (cancel || !result.ok) return
      useAppStore.getState().acceptChat(result.data)
    })
    void window.localCoder.getLogs(chatId).then((result) => {
      if (cancel || !result.ok) return
      useAppStore.getState().acceptLogs(chatId, result.data)
    })
    void window.localCoder.ensureMap(chatId).then((result) => {
      if (cancel || !result.ok) return
      useAppStore.getState().acceptMap(chatId, result.data.summary)
    })
    return () => {
      cancel = true
    }
  }, [activeId])
}
