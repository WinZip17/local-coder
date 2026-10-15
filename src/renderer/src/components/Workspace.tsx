import { ChatHeader } from './ChatHeader'
import { Composer } from './Composer'
import { EmptyProject } from './EmptyProject'
import { MessageList } from './MessageList'
import { PendingCard } from './PendingCard'
import { useAppStore } from '../store/useAppStore'

export function Workspace() {
  const hasChat = useAppStore((state) => state.chat !== null)
  const error = useAppStore((state) => state.error)
  const notice = useAppStore((state) => state.notice)
  const status = useAppStore((state) => state.status)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const consoleOpen = useAppStore((state) => state.consoleOpen)
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen)
  const setConsoleOpen = useAppStore((state) => state.setConsoleOpen)

  return (
    <section className="workspace">
      {!sidebarOpen && (
        <button
          type="button"
          className="restore restore-left"
          aria-expanded={false}
          aria-controls="chat-sidebar"
          onClick={() => setSidebarOpen(true)}
        >
          Чаты
        </button>
      )}
      {!consoleOpen && (
        <button
          type="button"
          className="restore restore-bottom"
          aria-expanded={false}
          aria-controls="project-console"
          onClick={() => setConsoleOpen(true)}
        >
          Консоль
        </button>
      )}
      {hasChat ? (
        <>
          <ChatHeader />
          {error && <p className="banner error">{error}</p>}
          {notice && <p className="banner info">{notice}</p>}
          <MessageList />
          {status && <p className="status">{status}</p>}
          <PendingCard />
          <Composer />
        </>
      ) : (
        <EmptyProject />
      )}
    </section>
  )
}
