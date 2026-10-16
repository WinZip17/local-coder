import { activeModelLabel } from '../../../shared/settings'
import { ChatList } from './ChatList'
import { useAppStore } from '../store/useAppStore'

export function Sidebar() {
  const settings = useAppStore((state) => state.settings)
  const openProject = useAppStore((state) => state.openProject)
  const openSettings = useAppStore((state) => state.openSettings)
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen)

  return (
    <aside id="chat-sidebar" className="sidebar">
      <div className="sidebar-slide">
        <div className="brand-row">
          <div className="brand">
            <strong><img className="brand-mark" src="./icon.png" alt="" />Local Coder</strong>
            <span>один чат — один проект</span>
          </div>
          <button
            type="button"
            className="quiet"
            aria-expanded
            aria-controls="chat-sidebar"
            onClick={() => setSidebarOpen(false)}
          >
            Скрыть
          </button>
        </div>
        <button className="primary wide" type="button" onClick={() => void openProject()}>Открыть проект</button>
        <ChatList />
        <div className="sidebar-foot">
          <p className="fine">{settings ? activeModelLabel(settings) : ''}</p>
          <button className="wide" type="button" onClick={openSettings}>Настройки</button>
        </div>
      </div>
    </aside>
  )
}
