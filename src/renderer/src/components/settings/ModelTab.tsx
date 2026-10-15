import type { ProviderId } from '../../../../shared/types'
import { ApiFields } from './ApiFields'
import { LocalModelFields } from './LocalModelFields'
import { OllamaFields } from './OllamaFields'
import { useSettingsFormContext } from './formContext'

const providers = [
  ['local', 'Локальная'],
  ['ollama', 'Ollama'],
  ['openai', 'API']
] as const satisfies ReadonlyArray<readonly [ProviderId, string]>

export function ModelTab() {
  const { draft, patch } = useSettingsFormContext()

  return (
    <>
      <div className="choice-row">
        {providers.map(([id, label]) => (
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
      {draft.activeProvider === 'local' && <LocalModelFields />}
      {draft.activeProvider === 'ollama' && <OllamaFields />}
      {draft.activeProvider === 'openai' && <ApiFields />}
    </>
  )
}
