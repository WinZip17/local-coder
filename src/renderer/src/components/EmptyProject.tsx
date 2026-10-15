import { useAppStore } from '../store/useAppStore'

export function EmptyProject() {
  const openProject = useAppStore((state) => state.openProject)
  return (
    <div className="placeholder">
      <h1>Выберите папку проекта</h1>
      <p>Новый чат создаётся только вместе с папкой. Повторное открытие той же папки возвращает прежний контекст.</p>
      <button className="primary" type="button" onClick={() => void openProject()}>Открыть проект</button>
    </div>
  )
}
