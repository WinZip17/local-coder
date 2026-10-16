import type { ToolCall } from './parse'
import { withoutFences } from './edits'

const pending = /провер(?:ю|ить)|посмотр(?:ю|еть)|прочит(?:аю|ать)|запущ(?:у|ать)|выполн(?:ю|ить)|установ(?:лю|ить)|созда(?:м|ть)|замен(?:ю|ить)|вызов(?:у|ить)|сначала|затем|I'll |I will |let me /i
const finished = /готово|полностью готов|задача (?:сделана|выполнена)|изменения внесены|ничего не (?:менял|нашёл|нашел)/i
const absent = /не существует|отсутствует|не найден|нет такой|нечего (?:удалять|менять|изменять)|does not exist|not found|nothing to (?:delete|change)/i

function mentionedPath(text: string): string | null {
  const quoted = text.match(/`([^`\n]+)`/g) ?? []
  for (const item of quoted) {
    const value = item.slice(1, -1).trim().replace(/\\/g, '/')
    if (/^(?:\.|(?:src|app|public|pages|components|docs)|[\w.@-]+(?:\/[\w.@-]+)+|[\w.@-]+\.[a-z0-9]+)$/i.test(value)) return value
  }
  const bare = text.match(/\b((?:src|app|pages|components)(?:\/[\w.-]+)+|[\w.-]+\.(?:tsx|ts|jsx|js|vue|css|html|json))\b/i)
  return bare?.[1] ?? null
}

function mentionedCommand(text: string): string | null {
  const quoted = text.match(/`([^`\n]*(?:npm|npx|pnpm|yarn)\s+[^`\n]+)`/i)
  if (quoted?.[1]) return quoted[1].trim()
  const bare = text.match(/\b((?:npm|npx|pnpm|yarn)\s+\S+(?:\s+\S+){0,8})/)
  return bare?.[1]?.trim() ?? null
}

export function listedDirectory(text: string): string | null {
  const named = text.match(/\blist_dir\b[^\n]{0,120}?\b(src|public|app|pages|components|docs)\b/i)
    ?? text.match(/\bпапк\w*\s+(src|public|app|pages|components|docs)\b/i)
  return named?.[1] ?? null
}

export function declaresFinished(visible: string): boolean {
  return finished.test(visible)
}

export function statesPendingWork(visible: string): boolean {
  const text = visible.trim()
  if (!text || absent.test(text)) return false
  if (finished.test(text) && !pending.test(text)) return false
  return pending.test(text)
}

export function impliedToolCall(visible: string): ToolCall | null {
  const text = visible.trim()
  const explicitCommand = /\brun_command\b/i.test(text) || /\b(?:npm|npx|pnpm|yarn)\s+(?:install|ci)\b/i.test(text)
  if (!statesPendingWork(text) && !/\blist_dir\b|\bread_file\b/i.test(text) && !explicitCommand) return null
  if (absent.test(text)) return null

  const prose = withoutFences(text)
  const path = mentionedPath(prose)
  const command = mentionedCommand(prose)
  if (command && /запущу|запускаю|выполню|установлю|\brun_command\b/i.test(prose)) {
    return { name: 'run_command', arguments: { command } }
  }
  if (path?.includes('.') && /прочит|открою|посмотрю файл|\bread_file\b|\bread\b/i.test(prose)) {
    return { name: 'read_file', arguments: { path, offset: 1 } }
  }
  const listing = /\blist_dir\b|структур|файлы|что появилось|главн\S*\s+(?:файл|компонент)|каталог|папк/i.test(prose)
    || (/содержим/i.test(prose) && /посмотр|провер|\blist_dir\b/i.test(prose))
  if (listing) {
    const listed = listedDirectory(prose)
    const directory = listed || (path && !/\.[a-z0-9]+$/i.test(path) ? path : '.')
    return { name: 'list_dir', arguments: { path: directory } }
  }
  return null
}

export function toolAfterSilence(lastTool: string): ToolCall | null {
  const listed = lastTool.match(/^list_dir\s+(\S+)/)
  if (listed) {
    const dir = listed[1] === '.' || listed[1] === './' ? '' : `${listed[1].replace(/\\/g, '/').replace(/\/$/, '')}/`
    const page = lastTool.match(/(?:^|\n)file ((?:App|page)\.(?:tsx|jsx|vue)|app\.vue)/i)
    if (page?.[1]) return { name: 'read_file', arguments: { path: `${dir}${page[1]}`, offset: 1 } }
    if (dir === '' && /(?:^|\n)dir src\b/.test(lastTool)) return { name: 'list_dir', arguments: { path: 'src' } }
  }
  if (/за концом/.test(lastTool)) {
    const path = lastTool.match(/^read_file\s+(\S+)/)?.[1]
    if (path) return { name: 'read_file', arguments: { path, offset: 1 } }
  }
  return null
}

export function pendingEditPath(visible: string): string | null {
  if (!/замен|перепиш|измен|обновл|впишу|запиш|write_file|edit_file/i.test(visible)) return null
  const path = mentionedPath(visible)
  return path?.includes('.') ? path : null
}
