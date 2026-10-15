import { activeModelLabel, modelProblem } from '../../../../shared/settings'
import type { Settings } from '../../../../shared/types'
import { useSettingsForm } from '../../hooks/useSettingsForm'
import { useAppStore } from '../../store/useAppStore'
import { ModelTab } from './ModelTab'
import { ProxyFields } from './ProxyFields'
import { SettingsFormProvider, useSettingsFormContext } from './formContext'

const emptyNotice = 'Пока модель не выбрана, чаты, правки файлов и запуск проектов недоступны.'

export function SettingsScreen() {
  const settings = useAppStore((state) => state.settings)
  if (!settings) return null
  return <SettingsBody settings={settings} />
}

function SettingsBody(props: { settings: Settings }) {
  const closeSettings = useAppStore((state) => state.closeSettings)
  const form = useSettingsForm(props.settings)
  const gate = modelProblem(props.settings) !== null

  return (
    <SettingsFormProvider value={form}>
      <div className={gate ? 'gate' : 'modal'}>
        {!gate && <button className="backdrop" type="button" aria-label="Закрыть настройки" onClick={closeSettings} />}
        <SettingsForm gate={gate} onClose={closeSettings} />
      </div>
    </SettingsFormProvider>
  )
}

function SettingsForm(props: { gate: boolean; onClose: () => void }) {
  const { draft, error, info, busy, tab, setTab, persist } = useSettingsFormContext()

  return (
    <form
      className="settings"
      onSubmit={(event) => {
        event.preventDefault()
        void persist(true)
      }}
    >
      <header className="settings-head">
        <p className="eyebrow">Local Coder</p>
        <h1>Настройки</h1>
        <p>{props.gate ? emptyNotice : `Сейчас: ${activeModelLabel(draft)}. Смена применяется со следующего сообщения.`}</p>
      </header>

      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'model'}
          className={tab === 'model' ? 'tab active' : 'tab'}
          onClick={() => setTab('model')}
        >
          Модель
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'proxy'}
          className={tab === 'proxy' ? 'tab active' : 'tab'}
          onClick={() => setTab('proxy')}
        >
          Прокси
        </button>
      </div>

      {tab === 'model' && <ModelTab />}
      {tab === 'proxy' && <ProxyFields />}

      {error && <p className="banner error">{error}</p>}
      {info && <p className="banner info">{info}</p>}

      <footer className="settings-actions">
        <button type="submit" className="primary" disabled={busy}>Сохранить</button>
        {!props.gate && <button type="button" onClick={props.onClose}>Закрыть</button>}
      </footer>
      <p className="fine">Git приложению недоступен. Коммиты и история репозитория остаются у вас.</p>
    </form>
  )
}
