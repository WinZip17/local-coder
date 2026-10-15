import { useEffect, useRef, useState } from 'react'
import { activeModelLabel, modelProblem } from '../../shared/settings'
import { displayStream } from '../../shared/parse'
import type { ChatRecord, ChatSummary, LogLine, PendingRequest, RunnerState, Settings } from '../../shared/types'
import { SettingsScreen } from './Settings'

function shortPath(value: string): string {
  if (value.length <= 48) return value
  return `…${value.slice(-48)}`
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [chat, setChat] = useState<ChatRecord | null>(null)
  const [mapText, setMapText] = useState('')
  const [draft, setDraft] = useState('')
  const [stream, setStream] = useState('')
  const [status, setStatus] = useState('')
  const [busyIds, setBusyIds] = useState<string[]>([])
  const [pending, setPending] = useState<PendingRequest | null>(null)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [command, setCommand] = useState('')
  const [runner, setRunner] = useState<RunnerState>({ running: false, chatId: null, command: null })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const activeRef = useRef<string | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
  activeRef.current = activeId

  useEffect(() => {
    void reload()
    const offAgent = window.localCoder.onAgentEvent((event) => {
      if (event.type === 'token') {
        setBusyIds((current) => current.includes(event.chatId) ? current : [...current, event.chatId])
        if (event.chatId === activeRef.current) setStream((value) => value + event.text)
      }
      if (event.type === 'flush' && event.chatId === activeRef.current) setStream('')
      if (event.type === 'status') {
        if (event.text) setBusyIds((current) => current.includes(event.chatId) ? current : [...current, event.chatId])
        if (event.chatId === activeRef.current) setStatus(event.text)
      }
      if (event.type === 'message') {
        setChat((current) => {
          if (!current || current.id !== event.chatId) return current
          if (current.messages.some((item) => item.id === event.message.id)) return current
          return { ...current, messages: [...current.messages, event.message] }
        })
      }
      if (event.type === 'pending') setPending(event.request)
      if (event.type === 'pending-clear') setPending((current) => current?.chatId === event.chatId ? null : current)
      if (event.type === 'error' && event.chatId === activeRef.current) setError(event.text)
      if (event.type === 'done') {
        setBusyIds((current) => current.filter((id) => id !== event.chatId))
        if (event.chatId === activeRef.current) {
          setStream('')
          setStatus('')
        }
        void window.localCoder.listChats().then((result) => {
          if (result.ok) setChats(result.data)
        })
      }
    })
    const offRunner = window.localCoder.onRunnerEvent((event) => {
      if (event.type === 'line' && event.line.chatId === activeRef.current) {
        setLogs((current) => [...current, event.line].slice(-800))
      }
      if (event.type === 'state') setRunner(event.state)
    })
    return () => {
      offAgent()
      offRunner()
    }
  }, [])

  useEffect(() => {
    let cancel = false
    setStream('')
    setStatus('')
    setError('')
    setNotice('')
    if (!activeId) {
      setChat(null)
      setLogs([])
      setMapText('')
      return
    }
    void window.localCoder.getChat(activeId).then((result) => {
      if (cancel || !result.ok) return
      setChat((current) => {
        if (current?.id === result.data.id && current.messages.length >= result.data.messages.length) return current
        return result.data
      })
    })
    void window.localCoder.getLogs(activeId).then((result) => {
      if (!cancel && result.ok) setLogs(result.data)
    })
    void window.localCoder.ensureMap(activeId).then((result) => {
      if (!cancel && result.ok) setMapText(result.data.summary)
    })
    return () => {
      cancel = true
    }
  }, [activeId])

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
  }, [chat?.messages.length, stream, pending])

  async function reload() {
    const [nextSettings, nextChats, state] = await Promise.all([
      window.localCoder.getSettings(),
      window.localCoder.listChats(),
      window.localCoder.getRunnerState()
    ])
    if (nextSettings.ok) setSettings(nextSettings.data)
    else setError(nextSettings.error)
    if (nextChats.ok) setChats(nextChats.data)
    if (state.ok) setRunner(state.data)
  }

  async function openProject() {
    setError('')
    const opened = await window.localCoder.openProject()
    if (!opened.ok) {
      setError(opened.error)
      return
    }
    if (!opened.data) return
    const listed = await window.localCoder.listChats()
    if (listed.ok) setChats(listed.data)
    setActiveId(opened.data.chat.id)
    setNotice(opened.data.created ? '' : 'Этот проект уже открыт. Контекст тот же.')
  }

  async function removeChat(chatId: string) {
    const removed = await window.localCoder.deleteChat(chatId)
    if (!removed.ok) {
      setError(removed.error)
      return
    }
    if (activeId === chatId) setActiveId(null)
    setDeleteId(null)
    const listed = await window.localCoder.listChats()
    if (listed.ok) setChats(listed.data)
  }

  async function send() {
    if (!activeId || !draft.trim()) return
    const text = draft
    setDraft('')
    setError('')
    setBusyIds((current) => current.includes(activeId) ? current : [...current, activeId])
    const result = await window.localCoder.sendMessage(activeId, text)
    if (!result.ok) {
      setError(result.error)
      setBusyIds((current) => current.filter((id) => id !== activeId))
    }
  }

  async function submitAnswer() {
    if (!pending || !answer.trim()) return
    const text = answer
    setAnswer('')
    const result = await window.localCoder.answer(pending.id, text)
    if (!result.ok) setError(result.error)
  }

  async function decide(approved: boolean) {
    if (!pending) return
    const result = await window.localCoder.decide(pending.id, approved)
    if (!result.ok) setError(result.error)
  }

  async function run() {
    if (!activeId || !command.trim()) return
    setError('')
    const result = await window.localCoder.runCommand(activeId, command)
    if (!result.ok) setError(result.error)
  }

  async function refreshMap() {
    if (!activeId) return
    const result = await window.localCoder.ensureMap(activeId)
    if (!result.ok) setError(result.error)
    else setMapText(result.data.summary)
  }

  if (!settings) return <main className="boot">Загрузка…</main>
  const ready = modelProblem(settings) === null
  const activePending = pending?.chatId === activeId ? pending : null
  const streaming = displayStream(stream)
  const chatBusy = activeId ? busyIds.includes(activeId) : false

  return (
    <>
      {ready && (
        <div className="shell">
          <aside className="sidebar">
            <div className="brand">
              <strong>Local Coder</strong>
              <span>один чат — один проект</span>
            </div>
            <button className="primary wide" type="button" onClick={() => void openProject()}>Открыть проект</button>
            <div className="chat-list">
              {chats.map((item) => (
                <div key={item.id} className={item.id === activeId ? 'chat-row active' : 'chat-row'}>
                  <button type="button" className="chat-select" onClick={() => setActiveId(item.id)}>
                    <strong>{item.title}</strong>
                    <small title={item.projectPath}>{shortPath(item.projectPath)}</small>
                  </button>
                  {deleteId === item.id ? (
                    <div className="confirm">
                      <button type="button" onClick={() => void removeChat(item.id)}>Удалить</button>
                      <button type="button" onClick={() => setDeleteId(null)}>Нет</button>
                    </div>
                  ) : (
                    <button type="button" className="quiet" onClick={() => setDeleteId(item.id)}>Удалить</button>
                  )}
                </div>
              ))}
              {!chats.length && <p className="empty">Чатов пока нет.</p>}
            </div>
          </aside>

          <section className="workspace">
            {chat ? (
              <>
                <header className="topbar">
                  <div>
                    <h1>{chat.title}</h1>
                    <p title={chat.projectPath}>{chat.projectPath}</p>
                    <p className="map-line">{mapText || 'Карта проекта ещё не собрана.'}</p>
                  </div>
                  <div className="top-actions">
                    <button type="button" onClick={() => void refreshMap()}>Обновить карту</button>
                    <button type="button" onClick={() => setSettingsOpen(true)}>{activeModelLabel(settings)}</button>
                  </div>
                </header>
                {error && <p className="banner error">{error}</p>}
                {notice && <p className="banner info">{notice}</p>}
                <div className="thread" ref={threadRef}>
                  {chat.messages.map((message) => (
                    <article key={message.id} className={`bubble ${message.role} ${message.kind}`}>
                      {message.content}
                    </article>
                  ))}
                  {streaming && <article className="bubble assistant text">{streaming}</article>}
                </div>
                {status && <p className="status">{status}</p>}
                {activePending && (
                  <div className="pending">
                    <strong>{activePending.title}</strong>
                    <pre>{activePending.detail}</pre>
                    {activePending.kind === 'ask' ? (
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
                          {activePending.kind === 'search' ? 'Искать' : 'Разрешить'}
                        </button>
                        <button type="button" onClick={() => void decide(false)}>Отклонить</button>
                      </div>
                    )}
                  </div>
                )}
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
                    disabled={Boolean(activePending) || chatBusy}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        void send()
                      }
                    }}
                  />
                  {chatBusy ? (
                    <button type="button" onClick={() => void window.localCoder.cancel(chat.id)}>Остановить</button>
                  ) : (
                    <button className="primary" type="submit" disabled={Boolean(activePending) || !draft.trim()}>Отправить</button>
                  )}
                </form>
              </>
            ) : (
              <div className="placeholder">
                <h1>Выберите папку проекта</h1>
                <p>Новый чат создаётся только вместе с папкой. Повторное открытие той же папки возвращает прежний контекст.</p>
                <button className="primary" type="button" onClick={() => void openProject()}>Открыть проект</button>
              </div>
            )}
          </section>

          <section className="console">
            <header>
              <strong>Консоль</strong>
              <span>
                {runner.running && runner.chatId === activeId
                  ? runner.command
                  : runner.running
                    ? 'Команда выполняется в другом чате'
                    : 'Проект не запущен'}
              </span>
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
                disabled={!chat}
                onChange={(event) => setCommand(event.target.value)}
              />
              {runner.running ? (
                <button type="button" onClick={() => void window.localCoder.stopCommand()}>Остановить</button>
              ) : (
                <button type="submit" disabled={!chat || !command.trim()}>Запустить</button>
              )}
            </form>
          </section>
        </div>
      )}
      {(!ready || settingsOpen) && (
        <SettingsScreen
          settings={settings}
          gate={!ready}
          onClose={ready ? () => setSettingsOpen(false) : undefined}
          onSaved={(next) => {
            setSettings(next)
            if (!modelProblem(next)) setSettingsOpen(false)
          }}
        />
      )}
    </>
  )
}
