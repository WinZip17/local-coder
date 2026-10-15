import { useAppStore } from '../store/useAppStore'

export function ConsolePanel() {
  const logs = useAppStore((state) => state.logs)
  const command = useAppStore((state) => state.command)
  const setCommand = useAppStore((state) => state.setCommand)
  const runner = useAppStore((state) => state.runner)
  const activeId = useAppStore((state) => state.activeId)
  const hasChat = useAppStore((state) => state.chat !== null)
  const run = useAppStore((state) => state.run)
  const stopCommand = useAppStore((state) => state.stopCommand)
  const setConsoleOpen = useAppStore((state) => state.setConsoleOpen)
  const status = consoleStatus(runner.running, runner.chatId, runner.command, activeId)

  return (
    <section id="project-console" className="console">
      <div className="console-slide">
        <header>
          <strong>Консоль</strong>
          <div className="console-tools">
            <span>{status}</span>
            <button
              type="button"
              className="quiet"
              aria-expanded
              aria-controls="project-console"
              onClick={() => setConsoleOpen(false)}
            >
              Скрыть
            </button>
          </div>
        </header>
        <div className="log">
          {logs.map((line) => (
            <p key={line.id} className={line.stream}>{line.text}</p>
          ))}
        </div>
        <form
          className="command"
          onSubmit={(event) => {
            event.preventDefault()
            void run()
          }}
        >
          <input
            value={command}
            spellCheck={false}
            placeholder="npm test, python main.py, cargo run"
            disabled={!hasChat}
            onChange={(event) => setCommand(event.target.value)}
          />
          {runner.running ? (
            <button type="button" onClick={stopCommand}>Остановить</button>
          ) : (
            <button type="submit" disabled={!hasChat || !command.trim()}>Запустить</button>
          )}
        </form>
      </div>
    </section>
  )
}

function consoleStatus(running: boolean, chatId: string | null, command: string | null, activeId: string | null): string {
  if (running && chatId === activeId) return command ?? ''
  if (running) return 'Команда выполняется в другом чате'
  return 'Проект не запущен'
}
