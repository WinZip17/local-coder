import type { ChatSummary } from '../../../shared/types'

export interface ChatRowProps {
  chat: ChatSummary
  active: boolean
  confirming: boolean
  onOpen: (chatId: string) => void
  onAskDelete: (chatId: string) => void
  onCancelDelete: () => void
  onConfirmDelete: (chatId: string) => void
}
