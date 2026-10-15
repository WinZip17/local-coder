import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'

export function useAgentEvents() {
  useEffect(() => {
    void useAppStore.getState().reload()
    const offAgent = window.localCoder.onAgentEvent((event) => {
      useAppStore.getState().applyAgentEvent(event)
    })
    const offRunner = window.localCoder.onRunnerEvent((event) => {
      useAppStore.getState().applyRunnerEvent(event)
    })
    return () => {
      offAgent()
      offRunner()
    }
  }, [])
}
