import { ConsolePanel } from './ConsolePanel'
import { Sidebar } from './Sidebar'
import { Workspace } from './Workspace'
import { useAppStore } from '../store/useAppStore'

export function Shell() {
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const consoleOpen = useAppStore((state) => state.consoleOpen)
  const className = `shell${sidebarOpen ? '' : ' sidebar-collapsed'}${consoleOpen ? '' : ' console-collapsed'}`

  return (
    <div className={className}>
      <Sidebar />
      <Workspace />
      <ConsolePanel />
    </div>
  )
}
