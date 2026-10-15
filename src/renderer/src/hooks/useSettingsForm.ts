import { useEffect, useState } from 'react'
import { modelProblem } from '../../../shared/settings'
import type { Settings } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import type { SettingsFormApi, SettingsTab } from '../types'

export function useSettingsForm(settings: Settings): SettingsFormApi {
  const applySavedSettings = useAppStore((state) => state.applySavedSettings)
  const [draft, setDraft] = useState(settings)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [apiModels, setApiModels] = useState<string[]>([])
  const [tab, setTab] = useState<SettingsTab>('model')

  useEffect(() => setDraft(settings), [settings])

  const patch = (next: Settings) => setDraft(next)

  async function persist(close: boolean): Promise<Settings | null> {
    const problem = modelProblem(draft)
    if (problem) {
      setTab(/прокси/i.test(problem) ? 'proxy' : 'model')
      setError(problem)
      setInfo('')
      return null
    }
    setBusy(true)
    setError('')
    const saved = await window.localCoder.saveSettings(draft)
    setBusy(false)
    if (!saved.ok) {
      setError(saved.error)
      return null
    }
    if (close) {
      applySavedSettings(saved.data)
      setInfo('Настройки сохранены.')
    }
    return saved.data
  }

  async function chooseFile() {
    const picked = await window.localCoder.pickGguf()
    if (picked.ok && picked.data) patch({ ...draft, local: { ...draft.local, modelPath: picked.data } })
  }

  async function loadOllama() {
    setBusy(true)
    setError('')
    const listed = await window.localCoder.listOllamaModels(draft.ollama.baseUrl)
    setBusy(false)
    if (!listed.ok) {
      setError(listed.error)
      return
    }
    setOllamaModels(listed.data)
    setInfo(listed.data.length ? `Найдено моделей: ${listed.data.length}.` : 'Ollama не вернула ни одной модели.')
  }

  async function loadApi() {
    const saved = await persist(false)
    if (!saved) return
    setBusy(true)
    const listed = await window.localCoder.listApiModels()
    setBusy(false)
    if (!listed.ok) {
      setError(listed.error)
      return
    }
    setApiModels(listed.data)
    setInfo(listed.data.length ? `API вернуло моделей: ${listed.data.length}.` : 'Список моделей пуст.')
  }

  async function probe() {
    const saved = await persist(false)
    if (!saved || saved.activeProvider !== 'local') {
      if (saved) setError('Для проверки включите локальную модель и сохраните её.')
      return
    }
    setBusy(true)
    setInfo('Загружаю модель. На первом запуске это может занять несколько минут.')
    const result = await window.localCoder.probeLocal()
    setBusy(false)
    if (!result.ok) setError(result.error)
    else setInfo(result.data.message)
  }

  return {
    draft,
    error,
    info,
    busy,
    tab,
    ollamaModels,
    apiModels,
    setTab,
    patch,
    persist,
    chooseFile,
    loadOllama,
    loadApi,
    probe
  }
}
