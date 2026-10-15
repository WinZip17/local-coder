import { useAppStore } from '../store/useAppStore'

export function ChatHeader() {
  const chat = useAppStore((state) => state.chat)
  const mapText = useAppStore((state) => state.mapText)
  const refreshMap = useAppStore((state) => state.refreshMap)
  const openSettings = useAppStore((state) => state.openSettings)
  if (!chat) return null

  return (
    <header className="topbar">
      <div>
        <h1>{chat.title}</h1>
        <p title={chat.projectPath}>{chat.projectPath}</p>
        <p className="map-line">{mapText || 'Карта проекта ещё не собрана.'}</p>
      </div>
      <div className="top-actions">
        <button type="button" onClick={() => void refreshMap()}>Обновить карту</button>
        <button type="button" onClick={openSettings}>Настройки</button>
      </div>
    </header>
  )
}
