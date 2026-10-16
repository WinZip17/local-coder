import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ProjectMap } from '../shared/types'

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
  '.idea',
  'bin',
  'obj'
])

const SOURCE_FILE = /\.(md|txt|rst|json|jsonc|ya?ml|toml|ini|cs|csproj|fs|fsproj|vb|java|kt|kts|scala|py|rb|php|go|rs|c|cc|cpp|h|hpp|m|mm|swift|dart|lua|r|sql|sh|ps1|bat|cmd|tsx?|jsx?|vue|svelte|astro|css|scss|html|xml|gradle|plist)$/i
const SPECIAL_NAME = /^(dockerfile|makefile|gemfile|cargo\.toml|go\.mod|package\.json|pyproject\.toml|composer\.json|build\.gradle|pom\.xml|requirements.*\.txt)$/i
const DOC_DIR = /^(docs|doc|documentation|wiki)$/i

function relativePath(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/')
}

function mapFile(projectPath: string): string {
  return path.join(projectPath, '.local-coder', 'project-map.json')
}

async function readMap(projectPath: string): Promise<ProjectMap | null> {
  try {
    const parsed = JSON.parse(await readFile(mapFile(projectPath), 'utf8')) as ProjectMap
    if (parsed?.version !== 1 || !Array.isArray(parsed.tree) || !Array.isArray(parsed.documents)) return null
    return parsed
  } catch {
    return null
  }
}

async function writeMap(projectPath: string, map: ProjectMap): Promise<void> {
  const folder = path.join(projectPath, '.local-coder')
  await mkdir(folder, { recursive: true })
  const ignore = path.join(folder, '.gitignore')
  if (!existsSync(ignore)) await writeFile(ignore, '*\n!.gitignore\n', 'utf8')
  const tmp = path.join(folder, 'project-map.json.tmp')
  await writeFile(tmp, JSON.stringify(map, null, 2), 'utf8')
  await rename(tmp, mapFile(projectPath))
}

function isDocument(relative: string, name: string): boolean {
  if (/^readme/i.test(name) && /\.(md|txt|rst)$/i.test(name)) return true
  if (relative.includes('/') && DOC_DIR.test(relative.split('/')[0] ?? '') && /\.(md|txt|rst)$/i.test(name)) return true
  return false
}

async function scan(projectPath: string): Promise<Pick<ProjectMap, 'tree' | 'documents'>> {
  const tree: ProjectMap['tree'] = []
  const documents: ProjectMap['documents'] = []
  let docBudget = 20_000
  const visited = { n: 0 }

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 4 || visited.n > 5000 || tree.length >= 500) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (visited.n++ > 5000 || tree.length >= 500) return
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || (entry.name.startsWith('.') && entry.name !== '.github')) continue
        const full = path.join(dir, entry.name)
        tree.push({ path: relativePath(projectPath, full), type: 'dir' })
        if (depth < 3) await walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      const full = path.join(dir, entry.name)
      const relative = relativePath(projectPath, full)
      if (SOURCE_FILE.test(entry.name) || SPECIAL_NAME.test(entry.name)) {
        tree.push({ path: relative, type: 'file' })
      }
      if (!isDocument(relative, entry.name) || documents.length >= 12 || docBudget <= 0) continue
      try {
        const info = await stat(full)
        if (info.size > 200_000) continue
        const excerpt = (await readFile(full, 'utf8')).slice(0, Math.min(3500, docBudget))
        documents.push({ path: relative, excerpt })
        docBudget -= excerpt.length
      } catch {
        continue
      }
    }
  }

  await walk(projectPath, 0)
  return { tree, documents }
}

function fallbackSummary(documents: ProjectMap['documents']): string {
  const readme = documents.find((item) => /^readme/i.test(path.basename(item.path)))
  const line = readme?.excerpt.split(/\r?\n/).map((item) => item.replace(/^#+\s*/, '').trim()).find(Boolean)
  return line || 'Карта создана автоматически по структуре проекта и документам.'
}

export async function ensureProjectMap(projectPath: string): Promise<ProjectMap> {
  const previous = await readMap(projectPath)
  const scanned = await scan(projectPath)
  const map: ProjectMap = {
    version: 1,
    updatedAt: new Date().toISOString(),
    summary: previous?.summaryFromAgent ? previous.summary : fallbackSummary(scanned.documents),
    summaryFromAgent: previous?.summaryFromAgent ?? false,
    notes: previous?.notes ?? [],
    tree: scanned.tree,
    documents: scanned.documents
  }
  await writeMap(projectPath, map)
  return map
}

export async function applyAgentMap(projectPath: string, summary?: string, notes?: string[]): Promise<ProjectMap> {
  const map = await ensureProjectMap(projectPath)
  if (summary?.trim()) {
    map.summary = summary.trim().slice(0, 2000)
    map.summaryFromAgent = true
  }
  if (notes?.length) {
    const merged = [...map.notes]
    for (const note of notes) {
      const clean = note.trim().slice(0, 500)
      if (clean && !merged.includes(clean)) merged.push(clean)
    }
    map.notes = merged.slice(-30)
  }
  map.updatedAt = new Date().toISOString()
  await writeMap(projectPath, map)
  return map
}

export async function loadProjectMap(projectPath: string): Promise<ProjectMap | null> {
  return readMap(projectPath)
}

export function systemPromptBudget(contextSize: number): number {
  const room = Math.max(1024, contextSize) - 1536
  return Math.max(1200, room * 2)
}

function clip(text: string, max: number): string {
  const clean = text.trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, Math.max(0, max - 1))}…`
}

function takeLines(lines: string[], maxChars: number): { text: string; shown: number } {
  const picked: string[] = []
  let used = 0
  for (const line of lines) {
    const next = used + line.length + 1
    if (picked.length > 0 && next > maxChars) break
    if (picked.length === 0 && line.length > maxChars) {
      picked.push(clip(line, maxChars))
      return { text: picked.join('\n'), shown: 1 }
    }
    picked.push(line)
    used = next
  }
  return { text: picked.join('\n'), shown: picked.length }
}

export function buildSystemPrompt(projectPath: string, map: ProjectMap, contextSize = 8192): string {
  const budget = systemPromptBudget(contextSize)
  const head = `Ты Local Coder, агент в десктопном приложении. Отвечай по-русски. Работай только внутри проекта:
${projectPath}

Правила:
- Карта ниже — только ориентир. В ней нет содержимого файлов. До правки посмотри проект инструментами.
- Сложную задачу дели на короткие шаги. Сначала list_dir, search_in_project или read_file, потом меняй файлы.
- Если пользователь просит «какую-нибудь», «один» или «любой» вариант, выбери первый подходящий сам. ask_user вызывай только когда без факта от пользователя задачу нельзя закончить. Создание проекта — исключение: способ генерации уточни.
- Новый проект любого стека создавай официальным генератором в текущей папке, не вручную. Сначала через ask_user предложи 2–3 варианта этого стека, и если у генератора есть выбор языка, перечисли его отдельно. Для React: npx create-vite@latest . --template react-ts --overwrite, npx create-vite@latest . --template react --overwrite и npx create-react-app . Для Vue, Nuxt и других стеков — их официальные create-команды, тоже с вариантом TypeScript, если он есть. Если пользователь уже назвал команду, не спрашивай снова.
- После ответа пользователя сразу вызови run_command с выбранным генератором. Фраза о намерении без инструмента ничего не создаёт. Каталог в команде — точка, как в выбранном варианте. Не создавай подпапку и не вызывай cd: следующая команда всё равно пойдёт из корня проекта. Папка .local-coder уже может лежать внутри: для генератора это пустой проект. Если он пишет Operation cancelled, повтори с --overwrite. Потом list_dir и замени шаблонную страницу через write_file по пути, который реально есть: src/App.tsx или src/App.jsx. Не придумывай путь с именем папки проекта. Пока write_file или edit_file не прошли без ошибки, не пиши, что страница изменена. npm run dev запускай только после npm install с кодом 0.
- Ненулевой код run_command — не конец задачи. Прочитай вывод, исправь причину и запусти команду снова. Не останавливайся на пересказе ошибки.
- search_in_project ищет одну подстроку. «button btn» не найдёт слово button. Для кнопки ищи «button» или «<button».
- Новый файл создавай через write_file, правку существующего — через edit_file. Если показал файл блоком кода, первая строка блока — комментарий с путём: // src/App.tsx. Такой файл будет создан сам. Пока файл не записан, не пиши, что задача сделана.
- Доступ к файлам этой папки уже есть. Новый файл записывай через write_file, существующий читай через read_file и меняй через edit_file. Не пиши, что ты текстовый AI, что нет доступа к файловой системе, и не проси пользователя создать файлы самому.
- Если в файле нет того, что просят удалить или изменить, напиши это один раз и остановись. Не предлагай менять другой объект.
- Git запрещён полностью: не запускай git и не открывай каталог .git. Коммиты остаются пользователю.
- Команды терминала отправляй только через run_command. Они выполнятся после подтверждения пользователя, вывод попадёт в консоль. Команду, которая уже завершилась с кодом 0, не вызывай повторно.
- Если в проекте и документах нет решения, вызови web_search. Поиск начнётся после подтверждения пользователя.
- Не выдумывай содержимое файлов.
- Намерение без инструмента ничего не делает. «Проверю», «прочитаю», «заменю» и «запущу» в том же ответе сопровождай вызовом list_dir, read_file, write_file, edit_file или run_command. Не заканчивай ход фразой о следующем шаге.
- Когда задача сделана, остановись и кратко перечисли изменения. Без tool_call.

Инструмент передаётся отдельным блоком, можно несколько:
<tool_call>
{"name":"list_dir","arguments":{"path":"."}}
</tool_call>

Инструменты:
- list_dir: {"path":"."}
- read_file: {"path":"src/app.ts","offset":1,"limit":400}
- search_in_project: {"query":"текст"}
- write_file: {"path":"src/app.ts","content":"полный новый текст"}
- edit_file: {"path":"src/app.ts","oldText":"точный фрагмент","newText":"замена","replaceAll":false}
- update_project_map: {"summary":"что это за проект","notes":["наблюдение"]}
- run_command: {"command":"npm test"}
- web_search: {"query":"поисковый запрос"}
- ask_user: {"question":"что уточнить"}`

  const summary = clip(map.summary || 'Краткого описания нет.', 700)
  const notes = map.notes.length ? map.notes.slice(-6).map((note) => `- ${clip(note, 240)}`).join('\n') : '- Пока нет заметок агента.'
  const treeLines = map.tree.map((item) => `${item.type === 'dir' ? 'dir' : 'file'} ${item.path}`)
  const docLines = map.documents.map((item) => item.path)
  const tree = takeLines(treeLines, 2200)
  const docs = takeLines(docLines, 800)
  const treeTail = tree.shown < treeLines.length ? `\nПоказано ${tree.shown} из ${treeLines.length}. Остальное смотри через list_dir.` : ''
  const docTail = docs.shown < docLines.length ? `\nПоказано ${docs.shown} из ${docLines.length}. Текст читай через read_file.` : ''
  const body = `${head}

Карта проекта — ориентир, не замена чтению файлов.
Кратко:
${summary}

Заметки:
${notes}

Структура:
${tree.text || 'Файлы проекта пока не распознаны.'}${treeTail}

Документы, только пути:
${docs.text || 'Документы не найдены.'}${docTail}`

  if (body.length <= budget) return body
  return `${clip(body, budget)}\nДальше смотри файлы инструментами list_dir и read_file.`
}
