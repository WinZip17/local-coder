import { modelProblem } from '../../shared/settings'
import { Shell } from './components/Shell'
import { SettingsScreen } from './components/settings/SettingsScreen'
import { useActiveChat } from './hooks/useActiveChat'
import { useAgentEvents } from './hooks/useAgentEvents'
import { useAppStore } from './store/useAppStore'

export function App() {
  useAgentEvents()
  useActiveChat()
  const settings = useAppStore((state) => state.settings)
  const settingsOpen = useAppStore((state) => state.settingsOpen)
  if (!settings) return <main className="boot">Загрузка…</main>
  const ready = modelProblem(settings) === null

  return (
    <>
      {ready && <Shell />}
      {(!ready || settingsOpen) && <SettingsScreen />}
    </>
  )
}
