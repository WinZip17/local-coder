import { useSettingsFormContext } from './formContext'

export function OllamaFields() {
  const { draft, busy, ollamaModels, patch, loadOllama } = useSettingsFormContext()

  return (
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
  )
}
