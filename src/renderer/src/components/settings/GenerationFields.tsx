import { recommendedGeneration } from '../../../../shared/settings'
import { useSettingsFormContext } from './formContext'

export function GenerationFields() {
  const { draft, patch } = useSettingsFormContext()

  return (
    <section>
      <h2>Параметры генерации</h2>
      <p className="hint">Одинаковы для локальной модели, Ollama и API. Если модель не принимает температуру или предел ответа, запрос повторится без этого поля.</p>
      <label>
        <span>Температура <span className="recommend">рекомендуется {recommendedGeneration.temperature}</span></span>
        <input
          type="number"
          min={0}
          max={2}
          step={0.1}
          value={draft.generation.temperature}
          onChange={(event) => patch({
            ...draft,
            generation: { ...draft.generation, temperature: Number(event.target.value) }
          })}
        />
      </label>
      <label>
        <span>Токены ответа <span className="recommend">рекомендуется {recommendedGeneration.maxTokens}</span></span>
        <input
          type="number"
          min={64}
          max={128000}
          step={64}
          value={draft.generation.maxTokens}
          onChange={(event) => patch({
            ...draft,
            generation: { ...draft.generation, maxTokens: Number(event.target.value) }
          })}
        />
      </label>
    </section>
  )
}
