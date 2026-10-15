import type { ChatRowProps } from '../types'
import { shortPath } from '../lib/shortPath'
import { useAppStore } from '../store/useAppStore'

export function ChatList() {
  const chats = useAppStore((state) => state.chats)
  const activeId = useAppStore((state) => state.activeId)
  const deleteId = useAppStore((state) => state.deleteId)
  const selectChat = useAppStore((state) => state.selectChat)
  const setDeleteId = useAppStore((state) => state.setDeleteId)
  const removeChat = useAppStore((state) => state.removeChat)

  return (
    <div className="chat-list">
      {chats.map((chat) => (
        <ChatRow
          key={chat.id}
          chat={chat}
          active={chat.id === activeId}
          confirming={deleteId === chat.id}
          onOpen={selectChat}
          onAskDelete={setDeleteId}
          onCancelDelete={() => setDeleteId(null)}
          onConfirmDelete={(chatId) => void removeChat(chatId)}
        />
      ))}
      {!chats.length && <p className="empty">Чатов пока нет.</p>}
    </div>
  )
}

function ChatRow(props: ChatRowProps) {
  return (
    <div className={props.active ? 'chat-row active' : 'chat-row'}>
      <button type="button" className="chat-select" onClick={() => props.onOpen(props.chat.id)}>
        <strong>{props.chat.title}</strong>
        <small title={props.chat.projectPath}>{shortPath(props.chat.projectPath)}</small>
      </button>
      {props.confirming ? (
        <div className="confirm">
          <button type="button" onClick={() => props.onConfirmDelete(props.chat.id)}>Удалить</button>
          <button type="button" onClick={props.onCancelDelete}>Нет</button>
        </div>
      ) : (
        <button type="button" className="quiet" onClick={() => props.onAskDelete(props.chat.id)}>Удалить</button>
      )}
    </div>
  )
}
