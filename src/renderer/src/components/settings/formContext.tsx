import { createContext, useContext, type ReactNode } from 'react'
import type { SettingsFormApi } from '../../types'

const SettingsFormContext = createContext<SettingsFormApi | null>(null)

export function SettingsFormProvider(props: { value: SettingsFormApi; children: ReactNode }) {
  return <SettingsFormContext.Provider value={props.value}>{props.children}</SettingsFormContext.Provider>
}

export function useSettingsFormContext(): SettingsFormApi {
  const value = useContext(SettingsFormContext)
  if (!value) throw new Error('Форма настроек не подключена.')
  return value
}
