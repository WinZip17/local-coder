export function isProjectCreationRequest(text: string): boolean {
  return /созда(й|ть|йте)|create/i.test(text) && /проект|приложен|project|\bapp\b/i.test(text)
}

export function commandFailed(toolText: string): boolean {
  if (!/run_command/.test(toolText)) return false
  if (/operation cancelled|отклонён пользователем/i.test(toolText)) return true
  const code = toolText.match(/Процесс завершился с кодом (\d+|null)/)
  if (code) return code[1] !== '0'
  return /npm ERR!|TypeError:|Error:|run_command ошибка/i.test(toolText)
}

export function generatorSucceeded(toolText: string): boolean {
  return /create-|nuxi|npm create|pnpm create|yarn create/i.test(toolText)
    && /Процесс завершился с кодом 0/.test(toolText)
    && !/operation cancelled/i.test(toolText)
}

const FLAG_WITH_VALUE = new Set(['--template', '-t', '--project-name'])

function isRunner(token: string): boolean {
  return /^(npx|npm|pnpm|yarn|bun)$/i.test(token)
}

function isPackageToken(token: string): boolean {
  if (/^(create|init|nuxi)$/i.test(token)) return true
  if (/create-|nuxi@/i.test(token)) return true
  return /^(vite|vue|react|nuxt|next)(@|$)/i.test(token)
}

export function scaffoldInCurrentFolder(command: string): string | null {
  const trimmed = command.trim()
  if (!/create-vite|create-react-app|create-vue|create-nuxt|create-next-app|\bnuxi\b|(?:npm|pnpm|yarn)\s+create\s+/i.test(trimmed)) return null
  const tokens = trimmed.split(/\s+/)
  const directories: number[] = []
  let lastPackage = -1
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? ''
    if (token === '--') continue
    if (token.startsWith('-')) {
      if (FLAG_WITH_VALUE.has(token.toLowerCase())) index += 1
      continue
    }
    if (isRunner(token)) continue
    if (isPackageToken(token)) {
      lastPackage = index
      continue
    }
    directories.push(index)
  }
  if (directories.length === 0) tokens.splice(Math.max(lastPackage, 0) + 1, 0, '.')
  else {
    for (const index of directories) {
      if (tokens[index] !== '.') tokens[index] = '.'
    }
  }
  const next = tokens.join(' ')
  if (/create-vite/i.test(next) && !/--overwrite\b/.test(next)) return `${next} --overwrite`
  return next
}

export function isDirectoryChange(command: string): boolean {
  return /^\s*cd(\s|$)/i.test(command.trim())
}

export function isInstallCommand(command: string): boolean {
  return /\b(npm|pnpm|yarn|bun)\s+(install|ci|i)\b/.test(command)
}

export function isDevServerCommand(command: string): boolean {
  return /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start)\b/.test(command)
}

export function isProjectInstall(command: string): boolean {
  return /^(npm|pnpm|yarn|bun)\s+(install|ci|i)(\s+--[\w.=/-]+)*$/i.test(normalizeCommand(command))
}

export function projectInstallSucceeded(toolText: string): boolean {
  const pattern = /(?:^|\n\n)run_command ([^\n]+)[\s\S]*?\nПроцесс завершился с кодом (\d+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(toolText))) {
    if (match[2] !== '0' || !isProjectInstall(match[1] ?? '')) continue
    if (/operation cancelled|отклонён пользователем/i.test(match[0])) continue
    return true
  }
  return false
}

export function outputLooped(text: string): boolean {
  const lines = text.replace(/\u001b\[[0-9;]*m/g, '').split(/\n/).map((line) => line.trim()).filter(Boolean)
  const reloads = lines.filter((line) => /modules (?:loaded|reloaded|invalidated)/i.test(line)).length
  if (reloads >= 12) return true
  const tail = lines.slice(-16)
  return tail.length >= 16 && tail.every((line) => line === tail[0])
}

export function dependenciesInstalled(toolTexts: string[]): boolean {
  let sawGenerator = false
  let ready = false
  for (const text of toolTexts) {
    if (generatorSucceeded(text)) {
      sawGenerator = true
      ready = false
    }
    if (projectInstallSucceeded(text)) ready = true
  }
  return !sawGenerator || ready
}

export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

export function commandAlreadySucceeded(toolTexts: string[], command: string): boolean {
  const wanted = normalizeCommand(command)
  if (!wanted) return false
  const pattern = /(?:^|\n\n)run_command ([^\n]+)\n[\s\S]*?\nПроцесс завершился с кодом (\d+)/g
  for (const text of toolTexts) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text))) {
      if (normalizeCommand(match[1] ?? '') !== wanted || match[2] !== '0') continue
      if (/operation cancelled|отклонён пользователем/i.test(match[0])) continue
      return true
    }
  }
  return false
}

function numberedOptions(question: string): Array<{ number: string; text: string }> {
  const options: Array<{ number: string; text: string }> = []
  const pattern = /(?:^|\s)(\d+)[.)]\s*([\s\S]*?)(?=(?:\s+\d+[.)]\s)|$)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(question))) {
    const text = match[2]?.replace(/\*\*/g, '').trim()
    if (match[1] && text) options.push({ number: match[1], text })
  }
  return options
}

function chosenOption(question: string, answer: string): string {
  const options = numberedOptions(question)
  const trimmed = answer.trim()
  const byNumber = options.find((option) => option.number === trimmed || new RegExp(`^${option.number}[.)\\s]`).test(trimmed))
  if (byNumber) return byNumber.text
  const lower = trimmed.toLowerCase()
  const byText = options.find((option) => lower.includes(option.text.toLowerCase()))
  return byText?.text || trimmed
}

export function commandFromCreationAnswer(question: string, answer: string): string | null {
  const source = chosenOption(question, answer)
  const explicit = source.match(/(?:npx|npm|pnpm|yarn)\s+\S*(?:create[\w@.-]*|nuxi)[^)\n`;]*/i)
  if (explicit?.[0]) return scaffoldInCurrentFolder(explicit[0].trim()) ?? explicit[0].trim()
  const text = source.toLowerCase()
  if (/create-react-app|create react app/.test(text)) return 'npx create-react-app .'
  if (/nuxi|nuxt/.test(text)) return 'npx nuxi@latest init .'
  if (/vite/.test(text) && /vue/.test(text)) return /typescript|type\s*script|\bts\b/.test(text) ? 'npx create-vue@latest . -- --ts' : 'npx create-vue@latest .'
  if (/vite/.test(text) && /typescript|type\s*script|\bts\b|react-ts/.test(text)) return 'npx create-vite@latest . --template react-ts --overwrite'
  if (/vite/.test(text) && /javascript|java\s*script|\bjs\b/.test(text)) return 'npx create-vite@latest . --template react --overwrite'
  return null
}

export function shouldAskCreationChoice(visible: string): boolean {
  const generators = visible.match(/npx\s+[\w@./-]*create[\w@./-]*|npm\s+create[\w@./-]*|pnpm\s+create[\w@./-]*|yarn\s+create[\w@./-]*|nuxi[\w@./-]*/gi) ?? []
  const unique = new Set(generators.map((item) => item.toLowerCase()))
  if (unique.size >= 2) return true
  return /какой способ|выберите способ|уточните способ|какой вариант/i.test(visible)
}
