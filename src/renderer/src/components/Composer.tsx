import { selectActivePending, selectChatBusy, useAppStore } from '../store/useAppStore'

export function Composer() {
  const draft = useAppStore((state) => state.draft)
  const setDraft = useAppStore((state) => state.setDraft)
  const send = useAppStore((state) => state.send)
  const cancelActive = useAppStore((state) => state.cancelActive)
  const busy = useAppStore(selectChatBusy)
  const blocked = useAppStore((state) => selectActivePending(state) !== null)

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
    >
      <textarea
        value={draft}
        placeholder="Опишите задачу. Сложное приложение сделает по шагам и спросит, если выбор неочевиден."
        disabled={blocked || busy}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void send()
          }
        }}
      />
      {busy ? (
        <button type="button" onClick={() => void cancelActive()}>Остановить</button>
      ) : (
        <button className="primary" type="submit" disabled={blocked || !draft.trim()}>Отправить</button>
      )}
    </form>
  )
}
