import type { AgentEvent, ChatRecord, ChatSummary, LogLine, OpenProjectResult, ProbeResult, ProjectMap, Result, RunnerEvent, RunnerState, Settings } from './types'

export interface LocalCoderApi {
  getSettings(): Promise<Result<Settings>>
  saveSettings(settings: Settings): Promise<Result<Settings>>
  listOllamaModels(baseUrl: string): Promise<Result<string[]>>
  listApiModels(baseUrl: string, apiKey: string): Promise<Result<string[]>>
  pickGguf(): Promise<Result<string | null>>
  probeLocal(): Promise<Result<ProbeResult>>
  listChats(): Promise<Result<ChatSummary[]>>
  openProject(folder?: string): Promise<Result<OpenProjectResult | null>>
  deleteChat(chatId: string): Promise<Result<null>>
  getChat(chatId: string): Promise<Result<ChatRecord>>
  ensureMap(chatId: string): Promise<Result<ProjectMap>>
  sendMessage(chatId: string, text: string): Promise<Result<null>>
  answer(requestId: string, text: string): Promise<Result<null>>
  decide(requestId: string, approved: boolean): Promise<Result<null>>
  cancel(chatId: string): Promise<Result<null>>
  runCommand(chatId: string, command: string): Promise<Result<null>>
  stopCommand(): Promise<Result<null>>
  getLogs(chatId: string): Promise<Result<LogLine[]>>
  getRunnerState(): Promise<Result<RunnerState>>
  onAgentEvent(listener: (event: AgentEvent) => void): () => void
  onRunnerEvent(listener: (event: RunnerEvent) => void): () => void
}
