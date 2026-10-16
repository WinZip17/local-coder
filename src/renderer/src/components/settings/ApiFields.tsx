import { useSettingsFormContext } from './formContext'

export function ApiFields() {
  const { draft, busy, apiModels, patch, loadApi } = useSettingsFormContext()

  return (
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
          value={draft.openai.model}
          spellCheck={false}
          onChange={(event) => patch({ ...draft, openai: { ...draft.openai, model: event.target.value } })}
        />
      </label>
      {apiModels.length > 0 && (
        <ul className="model-list" aria-label="Модели API">
          {apiModels.map((model) => (
            <li key={model}>
              <button
                type="button"
                className={model === draft.openai.model ? 'active' : undefined}
                onClick={() => patch({ ...draft, openai: { ...draft.openai, model } })}
              >
                {model}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" disabled={busy} onClick={() => void loadApi()}>Загрузить список моделей</button>
    </section>
  )
}
