import type { Settings } from '../../../../shared/types'
import { useSettingsFormContext } from './formContext'

export function ProxyFields() {
  const { draft, patch } = useSettingsFormContext()

  return (
    <section>
      <h2>Прокси</h2>
      <p className="hint">Используется для API и поиска. Локальные адреса и запуск проекта идут напрямую.</p>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.proxy.enabled}
          onChange={(event) => patch({ ...draft, proxy: { ...draft.proxy, enabled: event.target.checked } })}
        />
        Включить прокси
      </label>
      <div className="grid-3">
        <label>
          Протокол
          <select
            value={draft.proxy.protocol}
            onChange={(event) => patch({
              ...draft,
              proxy: { ...draft.proxy, protocol: event.target.value as Settings['proxy']['protocol'] }
            })}
          >
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
            <option value="socks5">SOCKS5</option>
          </select>
        </label>
        <label>
          Хост
          <input
            value={draft.proxy.host}
            spellCheck={false}
            onChange={(event) => patch({ ...draft, proxy: { ...draft.proxy, host: event.target.value } })}
          />
        </label>
        <label>
          Порт
          <input
            type="number"
            min={1}
            max={65535}
            value={draft.proxy.port}
            onChange={(event) => patch({ ...draft, proxy: { ...draft.proxy, port: Number(event.target.value) } })}
          />
        </label>
      </div>
      <div className="grid-2">
        <label>
          Логин
          <input
            value={draft.proxy.username}
            autoComplete="off"
            onChange={(event) => patch({ ...draft, proxy: { ...draft.proxy, username: event.target.value } })}
          />
        </label>
        <label>
          Пароль
          <input
            type="password"
            autoComplete="off"
            value={draft.proxy.password}
            onChange={(event) => patch({ ...draft, proxy: { ...draft.proxy, password: event.target.value } })}
          />
        </label>
      </div>
    </section>
  )
}
