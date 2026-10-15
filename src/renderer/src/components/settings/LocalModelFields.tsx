import type { GpuMode } from '../../../../shared/types'
import { useSettingsFormContext } from './formContext'

export function LocalModelFields() {
  const { draft, busy, patch, chooseFile, probe } = useSettingsFormContext()

  return (
    <section>
      <h2>Локальная GGUF</h2>
      <p className="hint">Файл запускается внутри приложения. Авто выбирает CUDA, если она доступна, иначе Vulkan. Если видеокарта не проходит проверку, расчёт идёт на CPU. Слои, которым не хватает видеопамяти рядом с контекстом, остаются в оперативной памяти.</p>
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
  )
}
