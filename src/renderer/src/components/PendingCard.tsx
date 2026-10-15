import { selectActivePending, useAppStore } from '../store/useAppStore'

export function PendingCard() {
  const pending = useAppStore(selectActivePending)
  const answer = useAppStore((state) => state.answer)
  const setAnswer = useAppStore((state) => state.setAnswer)
  const submitAnswer = useAppStore((state) => state.submitAnswer)
  const decide = useAppStore((state) => state.decide)
  if (!pending) return null

  return (
    <div className="pending">
      <strong>{pending.title}</strong>
      <pre>{pending.detail}</pre>
      {pending.kind === 'ask' ? (
        <div className="inline">
          <textarea
            value={answer}
            placeholder="Ответ на уточнение"
            onChange={(event) => setAnswer(event.target.value)}
          />
          <button className="primary" type="button" onClick={() => void submitAnswer()}>Ответить</button>
        </div>
      ) : (
        <div className="inline">
          <button className="primary" type="button" onClick={() => void decide(true)}>
            {pending.kind === 'search' ? 'Искать' : 'Разрешить'}
          </button>
          <button type="button" onClick={() => void decide(false)}>Отклонить</button>
        </div>
      )}
    </div>
  )
}
