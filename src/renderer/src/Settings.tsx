import { useEffect, useState } from 'react'
import { activeModelLabel, modelProblem } from '../../shared/settings'
import type { GpuMode, Settings } from '../../shared/types'

const emptyNotice = 'Пока модель не выбрана, чаты, правки файлов и запуск проектов недоступны.'

export function SettingsScreen(props: {
  settings: Settings
  gate: boolean
  onClose?: () => void
  onSaved: (settings: Settings) => void
}) {
  const [draft, setDraft] = useState(props.settings)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [apiModels, setApiModels] = useState<string[]>([])

  useEffect(() => setDraft(props.settings), [props.settings])

  const patch = (next: Settings) => setDraft(next)

  async function persist(close: boolean): Promise<Settings | null> {
    const problem = modelProblem(draft)
    if (problem) {
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
      props.onSaved(saved.data)
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

  return (
    <div className={props.gate ? 'gate' : 'modal'}>
      {!props.gate && <button className="backdrop" type="button" aria-label="Закрыть настройки" onClick={props.onClose} />}
      <form
        className="settings"
        onSubmit={(event) => {
          event.preventDefault()
          void persist(true)
        }}
      >
        <header className="settings-head">
          <p className="eyebrow">Local Coder</p>
          <h1>Модель</h1>
          <p>{props.gate ? emptyNotice : `Сейчас: ${activeModelLabel(draft)}. Смена применяется со следующего сообщения.`}</p>
        </header>

        <div className="choice-row">
          {([
            ['local', 'Локальная'],
            ['ollama', 'Ollama'],
            ['openai', 'API']
          ] as const).map(([id, label]) => (
            <label key={id} className={draft.activeProvider === id ? 'choice active' : 'choice'}>
              <input
                type="radio"
                name="provider"
                checked={draft.activeProvider === id}
                onChange={() => patch({ ...draft, activeProvider: id })}
              />
              {label}
            </label>
          ))}
        </div>

        {draft.activeProvider === 'local' && (
          <section>
            <h2>Локальная GGUF</h2>
            <p className="hint">Файл запускается внутри приложения. Авто выбирает CUDA, если она доступна, иначе Vulkan. Если видеокарта не проходит проверку, расчёт идёт на CPU.</p>
            <label>
              Файл модели
              <div className="inline">
                <input
                  value={draft.local.modelPath}
                  spellCheck={false}
                  onChange={(event) => patch({ ...draft, local: { ...draft.local, modelPath: event.target.value } })}
                />
                <button type="button" onClick={() => void chooseFile()}>Обзор</button>
              </div>
            </label>
            <label>
              Видеокарта
              <select
                value={draft.local.gpu}
                onChange={(event) => patch({ ...draft, local: { ...draft.local, gpu: event.target.value as GpuMode } })}
              >
                <option value="auto">Авто — CUDA, иначе Vulkan</option>
                <option value="cuda">CUDA</option>
                <option value="vulkan">Vulkan</option>
                <option value="cpu">Только CPU</option>
              </select>
            </label>
            <label>
              Контекст, токены
              <input
                type="number"
                min={512}
                max={262144}
                value={draft.local.contextSize}
                onChange={(event) => patch({ ...draft, local: { ...draft.local, contextSize: Number(event.target.value) } })}
              />
            </label>
            <button type="button" disabled={busy} onClick={() => void probe()}>Проверить загрузку</button>
          </section>
        )}

        {draft.activeProvider === 'ollama' && (
          <section>
            <h2>Ollama</h2>
            <p className="hint">Нужна уже запущенная Ollama на этом компьютере.</p>
            <label>
              Адрес
              <input
                value={draft.ollama.baseUrl}
                spellCheck={false}
                onChange={(event) => patch({ ...draft, ollama: { ...draft.ollama, baseUrl: event.target.value } })}
              />
            </label>
            <label>
              Модель
              <input
                list="ollama-models"
                value={draft.ollama.model}
                spellCheck={false}
                onChange={(event) => patch({ ...draft, ollama: { ...draft.ollama, model: event.target.value } })}
              />
              <datalist id="ollama-models">
                {ollamaModels.map((model) => <option key={model} value={model} />)}
              </datalist>
            </label>
            <button type="button" disabled={busy} onClick={() => void loadOllama()}>Обновить список</button>
          </section>
        )}

        {draft.activeProvider === 'openai' && (
          <section>
            <h2>API</h2>
            <p className="hint">Официальный OpenAI или совместимый сервер. Для локального сервера ключ можно оставить пустым.</p>
            <label>
              Адрес
              <input
                value={draft.openai.baseUrl}
                spellCheck={false}
                onChange={(event) => patch({ ...draft, openai: { ...draft.openai, baseUrl: event.target.value } })}
              />
            </label>
            <label>
              Ключ API
              <input
                type="password"
                autoComplete="off"
                value={draft.openai.apiKey}
                onChange={(event) => patch({ ...draft, openai: { ...draft.openai, apiKey: event.target.value } })}
              />
            </label>
            <label>
              Имя модели
              <input
                list="api-models"
                value={draft.openai.model}
                spellCheck={false}
                onChange={(event) => patch({ ...draft, openai: { ...draft.openai, model: event.target.value } })}
              />
              <datalist id="api-models">
                {apiModels.map((model) => <option key={model} value={model} />)}
              </datalist>
            </label>
            <button type="button" disabled={busy} onClick={() => void loadApi()}>Загрузить список моделей</button>
          </section>
        )}

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

        {error && <p className="banner error">{error}</p>}
        {info && <p className="banner info">{info}</p>}

        <footer className="settings-actions">
          <button type="submit" className="primary" disabled={busy}>Сохранить</button>
          {!props.gate && <button type="button" onClick={props.onClose}>Закрыть</button>}
        </footer>
        <p className="fine">Git приложению недоступен. Коммиты и история репозитория остаются у вас.</p>
      </form>
    </div>
  )
}
