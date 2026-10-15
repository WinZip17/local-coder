import type { Settings } from '../../../shared/types'

export type SettingsTab = 'model' | 'proxy'

export interface SettingsFormApi {
  draft: Settings
  error: string
  info: string
  busy: boolean
  tab: SettingsTab
  ollamaModels: string[]
  apiModels: string[]
  setTab: (tab: SettingsTab) => void
  patch: (next: Settings) => void
  persist: (close: boolean) => Promise<Settings | null>
  chooseFile: () => Promise<void>
  loadOllama: () => Promise<void>
  loadApi: () => Promise<void>
  probe: () => Promise<void>
}
