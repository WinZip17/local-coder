import { readdir, readFile, rename, stat, writeFile, mkdir, realpath } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { ToolCall } from '../shared/parse'
import { resolveInsideProject } from '../shared/safety'
import { applyAgentMap } from './project'

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.local-coder',
  'dist',
  'build',
  'out',
  'release',
  'coverage',
  '.next',
  '.nuxt',
  'target',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  'bin',
  'obj'
])

const BINARY = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'pdf', 'zip', 'gz', '7z', 'wasm', 'exe', 'dll', 'so', 'dylib', 'mp3', 'mp4', 'woff', 'woff2', 'ttf', 'gguf', 'bin', 'pdb', 'class', 'jar', 'lock'])

function textArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value : ''
}

function numberArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = Number(args[key])
  return Number.isFinite(value) ? value : fallback
}

function clip(text: string, max = 12_000): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n… обрезано, всего ${text.length} символов.`
}

async function assertParentInside(projectPath: string, target: string): Promise<void> {
  const root = await realpath(projectPath).catch(() => path.resolve(projectPath))
  let current = target
  while (!existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  const real = await realpath(current).catch(() => path.resolve(current))
  const relative = path.relative(root, real)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Путь выходит за пределы проекта.')
}

async function writeAtomic(target: string, content: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true })
  const tmp = `${target}.${crypto.randomUUID()}.tmp`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, target)
}

export async function executeTool(projectPath: string, call: ToolCall): Promise<string> {
  const args = call.arguments
  if (call.name === 'list_dir') {
    const requested = textArg(args, 'path') || '.'
    const target = resolveInsideProject(projectPath, requested)
    const entries = await readdir(target, { withFileTypes: true })
    const lines = entries
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .slice(0, 200)
      .map((entry) => `${entry.isDirectory() ? 'dir' : 'file'} ${entry.name}`)
    return `list_dir ${requested}\n${lines.join('\n') || 'Пусто.'}`
  }

  if (call.name === 'read_file') {
    const target = resolveInsideProject(projectPath, textArg(args, 'path'))
    const raw = await readFile(target, 'utf8')
    const lines = raw.split(/\r?\n/)
    const offset = Math.max(1, Math.floor(numberArg(args, 'offset', 1)))
    const limit = Math.min(800, Math.max(1, Math.floor(numberArg(args, 'limit', 400))))
    const slice = lines.slice(offset - 1, offset - 1 + limit)
    return clip(`read_file ${textArg(args, 'path')} строки ${offset}-${offset + slice.length - 1} из ${lines.length}\n${slice.join('\n')}`)
  }

  if (call.name === 'search_in_project') {
    const query = textArg(args, 'query').trim()
    if (query.length < 2) throw new Error('Запрос поиска короче 2 символов.')
    const hits: string[] = []
    const walk = async (dir: string): Promise<void> => {
      if (hits.length >= 40) return
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (hits.length >= 40) return
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) await walk(path.join(dir, entry.name))
          continue
        }
        const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
        if (BINARY.has(ext)) continue
        const full = path.join(dir, entry.name)
        try {
          const info = await stat(full)
          if (info.size > 1_000_000) continue
          const raw = await readFile(full, 'utf8')
          const lines = raw.split(/\r?\n/)
          for (let index = 0; index < lines.length; index += 1) {
            if (!lines[index]?.toLowerCase().includes(query.toLowerCase())) continue
            const relative = path.relative(projectPath, full).split(path.sep).join('/')
            hits.push(`${relative}:${index + 1}: ${lines[index]?.trim().slice(0, 240)}`)
            if (hits.length >= 40) return
          }
        } catch {
          continue
        }
      }
    }
    await walk(projectPath)
    return `search_in_project ${query}\n${hits.join('\n') || 'Ничего не найдено.'}`
  }

  if (call.name === 'write_file') {
    if (typeof args.content !== 'string') throw new Error('write_file требует поле content со строкой.')
    if (args.content.length > 1_500_000) throw new Error('Файл слишком большой для одной записи.')
    const filePath = textArg(args, 'path')
    const target = resolveInsideProject(projectPath, filePath)
    await assertParentInside(projectPath, target)
    await writeAtomic(target, args.content)
    return `write_file ${filePath}: записано ${Buffer.byteLength(args.content)} байт.`
  }

  if (call.name === 'edit_file') {
    const filePath = textArg(args, 'path')
    const oldText = textArg(args, 'oldText')
    const newText = typeof args.newText === 'string' ? args.newText : ''
    if (!oldText) throw new Error('edit_file требует точный oldText.')
    const target = resolveInsideProject(projectPath, filePath)
    const current = await readFile(target, 'utf8')
    const count = current.split(oldText).length - 1
    if (count === 0) throw new Error('Фрагмент не найден. Прочитай файл и передай точный текст.')
    if (count > 1 && args.replaceAll !== true) throw new Error(`Фрагмент встречается ${count} раз. Добавь контекст или replaceAll: true.`)
    const next = args.replaceAll === true ? current.split(oldText).join(newText) : current.replace(oldText, newText)
    await assertParentInside(projectPath, target)
    await writeAtomic(target, next)
    return `edit_file ${filePath}: заменено ${args.replaceAll === true ? count : 1} фрагмент(ов).`
  }

  if (call.name === 'update_project_map') {
    const notes = Array.isArray(args.notes) ? args.notes.filter((item): item is string => typeof item === 'string') : []
    const map = await applyAgentMap(projectPath, textArg(args, 'summary'), notes)
    return `update_project_map: ${map.summary}`
  }

  throw new Error(`Неизвестный инструмент ${call.name}.`)
}
