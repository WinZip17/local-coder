export interface SnippetEdit {
  path: string
  oldText: string
  newText: string
}

const sourcePath = /(?<![A-Za-z0-9_./-])((?:[A-Za-z0-9_.@-]+[\\/])+[A-Za-z0-9_.@-]+\.[A-Za-z0-9]+)(?![A-Za-z0-9_./-])/g
const bareFile = /(?<![A-Za-z0-9_./-])([A-Za-z][\w.@-]*\.(?:md|markdown|txt|json|html|css|scss|ts|tsx|js|jsx|vue|svg|mjs|cjs))(?![A-Za-z0-9_./-])/gi
const frameworkName = /^(?:next|node|vue|nuxt|react|express|three|d3)\.js$/i

function rememberFile(value: string): string {
  return frameworkName.test(value) ? '' : value.replace(/\\/g, '/')
}

function lastPath(text: string): string {
  sourcePath.lastIndex = 0
  bareFile.lastIndex = 0
  let found = ''
  let at = -1
  const take = (match: RegExpMatchArray) => {
    if (match.index === undefined || match.index < at || !match[1]) return
    const path = rememberFile(match[1])
    if (!path) return
    found = path
    at = match.index
  }
  for (const match of text.matchAll(sourcePath)) take(match)
  for (const match of text.matchAll(bareFile)) take(match)
  return found
}

function namedFiles(text: string): string[] {
  sourcePath.lastIndex = 0
  bareFile.lastIndex = 0
  const found: string[] = []
  const add = (value: string) => {
    const path = rememberFile(value)
    if (!path || found.includes(path)) return
    found.push(path)
  }
  for (const match of text.matchAll(sourcePath)) if (match[1]) add(match[1])
  for (const match of text.matchAll(bareFile)) if (match[1]) add(match[1])
  return found
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function deletionPatterns(userText: string, visible: string): RegExp[] {
  const blob = `${userText}\n${visible}`
  if (!/удал/i.test(blob)) return []
  const specific: RegExp[] = []
  const assignment = /['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\s*=\s*['"`]([^'"`\n]+)['"`]/g
  for (const match of blob.matchAll(assignment)) {
    const name = match[1]
    const value = match[2]
    if (!name || !value) continue
    specific.push(new RegExp(`^\\s*${escapeRegExp(name)}\\s*=\\s*['"\`]${escapeRegExp(value)}['"\`]\\s*[,;]?\\s*$`))
  }
  if (specific.length) return specific
  const names = new Set<string>()
  for (const match of blob.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) {
    if (match[1]) names.add(match[1])
  }
  return [...names].map((name) => new RegExp(`^\\s*${escapeRegExp(name)}\\s*=`))
}

export function describedLineEdit(files: Array<{ path: string; text: string }>, userText: string, visible: string): SnippetEdit | null {
  const patterns = deletionPatterns(userText, visible)
  for (const pattern of patterns) {
    const hits: Array<{ path: string; text: string; index: number }> = []
    for (const file of files) {
      const { lines } = splitLines(file.text)
      lines.forEach((line, index) => {
        if (pattern.test(line)) hits.push({ path: file.path, text: file.text, index })
      })
    }
    if (hits.length > 1) return null
    const hit = hits[0]
    if (!hit) continue
    const newline = hit.text.includes('\r\n') ? '\r\n' : '\n'
    const { lines } = splitLines(hit.text)
    const line = lines[hit.index] ?? ''
    if (!line.trim()) continue
    const oldText = hit.index < lines.length - 1 ? `${line}${newline}` : `${hit.index > 0 ? newline : ''}${line}`
    return { path: hit.path, oldText, newText: '' }
  }
  return null
}

function pathComment(snippet: string): { path: string; body: string } {
  const lines = snippet.split('\n')
  const first = lines[0]?.trim() ?? ''
  const comment = first.match(/^(?:\/\/|\/\*|#)\s*((?:[\w.@*-]+[\\/])*[\w.@*-]+\.[A-Za-z0-9]+)\s*(?:\*\/)?$/)
  if (!comment?.[1]) return { path: '', body: snippet }
  return {
    path: comment[1].replace(/\\/g, '/'),
    body: lines.slice(1).join('\n').replace(/^\n+|\n+$/g, '')
  }
}

function fenceBlocks(visible: string): Array<{ header: string; body: string; start: number; end: number; closed: boolean }> {
  const lines = visible.split('\n')
  const blocks: Array<{ header: string; body: string; start: number; end: number; closed: boolean }> = []
  let index = 0
  while (index < lines.length) {
    const open = (lines[index] ?? '').match(/^ {0,3}(`{3,})([^`]*)\s*$/)
    if (!open?.[1]) {
      index += 1
      continue
    }
    const marker = open[1].length
    const header = (open[2] ?? '').trim()
    const markdown = /^(?:md|markdown)\b/i.test(header)
    const body: string[] = []
    let depth = 1
    let closed = false
    let cursor = index + 1
    for (; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] ?? ''
      const tick = line.match(/^ {0,3}(`{3,})([^`]*)\s*$/)
      if (tick?.[1] && tick[1].length >= marker) {
        const info = (tick[2] ?? '').trim()
        if (markdown && info) {
          depth += 1
          body.push(line)
          continue
        }
        if (markdown && depth > 1) {
          depth -= 1
          body.push(line)
          continue
        }
        if (markdown && depth === 1) {
          const upcoming = lines.slice(cursor + 1).find((item) => item.trim()) ?? ''
          if (/^[.├│└┌┐─]/.test(upcoming) || /^\s+\S/.test(upcoming)) {
            depth += 1
            body.push(line)
            continue
          }
        }
        cursor += 1
        closed = true
        break
      }
      body.push(line)
    }
    blocks.push({ header, body: body.join('\n'), start: index, end: cursor, closed })
    index = cursor
  }
  return blocks
}

export function hasUnclosedFence(visible: string): boolean {
  return fenceBlocks(visible).some((block) => !block.closed)
}

export function pathCommentFile(visible: string): { path: string; snippet: string } | null {
  const lines = withoutFences(visible).split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const comment = (lines[index] ?? '').trim().match(/^(?:\/\/|\/\*|#)\s*((?:[\w.@*-]+[\\/])*[\w.@*-]+\.[A-Za-z0-9]+)\s*(?:\*\/)?$/)
    if (!comment?.[1]) continue
    const body = lines.slice(index + 1).join('\n').replace(/^\n+|\n+$/g, '')
    if (body.split('\n').filter((line) => line.trim()).length < 6) continue
    if (!/export default|function\s+App\b/.test(body)) continue
    return { path: comment[1].replace(/\\/g, '/'), snippet: body.endsWith('\n') ? body : `${body}\n` }
  }
  return null
}

export function withoutFences(visible: string): string {
  const lines = visible.split('\n')
  const skip = new Set<number>()
  for (const block of fenceBlocks(visible)) {
    for (let index = block.start; index < block.end; index += 1) skip.add(index)
  }
  return lines.filter((_, index) => !skip.has(index)).join('\n')
}
export function componentSnippet(visible: string): string | null {
  for (const block of fenceBlocks(visible)) {
    const header = block.header.split(/\s+/)[0]?.toLowerCase() ?? ''
    if (header && !/^(?:tsx|jsx|vue|typescript|ts|javascript|js|react)?$/.test(header)) continue
    if (!block.closed) continue
    const body = block.body.replace(/^\n+|\n+$/g, '')
    if (body.split('\n').length < 6) continue
    if (!/function\s+App\b/.test(body) || !/return\s*\(?/.test(body)) continue
    return body.endsWith('\n') ? body : `${body}\n`
  }
  return null
}

function inferredPath(header: string, body: string): string {
  const lang = header.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if ((lang === 'json' || body.trim().startsWith('{')) && /"name"\s*:/.test(body) && /"(?:dependencies|devDependencies|scripts)"\s*:/.test(body)) return 'package.json'
  if (/^\s*<!doctype html/i.test(body) || /<html[\s>]/i.test(body)) return 'index.html'
  return ''
}

export function describedSnippets(visible: string, userText = ''): Array<{ path: string; snippet: string }> {
  const lines = visible.split('\n')
  const items: Array<{ path: string; snippet: string }> = []
  for (const block of fenceBlocks(visible)) {
    if (!block.closed || /^tool\b/i.test(block.header) || isShellFence(block.header)) continue
    const before = lines.slice(Math.max(0, block.start - 8), block.start).join('\n')
    const raw = block.body.replace(/^\n+|\n+$/g, '')
    const commented = pathComment(raw)
    const path = commented.path || lastPath(block.header) || inferredPath(block.header, commented.body) || lastPath(before)
    const snippet = commented.path ? commented.body : raw
    if (snippet.trim().length < 8) continue
    items.push({ path, snippet })
  }
  const unnamed = items.filter((item) => !item.path)
  const named = namedFiles(userText)
  if (named.length === 1 && unnamed.length) {
    const target = [...unnamed].sort((left, right) => right.snippet.length - left.snippet.length)[0]
    if (target) target.path = named[0] ?? ''
  }
  const ready = items.filter((item) => item.path)
  const unique: Array<{ path: string; snippet: string }> = []
  for (const item of ready) {
    if (unique.some((other) => other.path === item.path)) continue
    unique.push(item)
  }
  return unique
}

function isShellFence(header: string): boolean {
  const lang = header.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  return /^(?:bash|sh|shell|zsh|console|powershell|ps1|cmd)$/.test(lang)
}

function firstShellBlock(visible: string): { command: string; endLine: number } | null {
  for (const block of fenceBlocks(visible)) {
    if (!block.closed || !isShellFence(block.header)) continue
    const command = block.body
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('#') && /^(?:npx|npm|pnpm|yarn|bun)\b/.test(line))
    if (command) return { command, endLine: block.end }
  }
  return null
}

export function shellCommand(visible: string): string | null {
  return firstShellBlock(visible)?.command ?? null
}

export function clipToFirstCommand(visible: string): string {
  const found = firstShellBlock(visible)
  if (!found) return visible
  return visible.split('\n').slice(0, found.endLine).join('\n')
}

export function replacementContent(userText: string, path: string, snippet: string, fileText: string): string | null {
  const name = path.split('/').pop() ?? path
  if (!new RegExp(escapeRegExp(name), 'i').test(userText)) return null
  if (!/обнов|перепиш|замен|измен|запиш|содержим/i.test(userText)) return null
  const lines = snippet.split('\n').filter((line) => line.trim()).length
  const markdown = /\.md$/i.test(path) && /^\s*#\s+\S/m.test(snippet) && snippet.trim().length >= 40
  if (lines < 6 && !markdown) return null
  const next = snippet.endsWith('\n') ? snippet : `${snippet}\n`
  if (fileText.replace(/\r\n/g, '\n').trim() === next.trim()) return null
  return next
}

function splitLines(text: string): { lines: string[]; newline: string } {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n$/, '')
  return { lines: normalized.length ? normalized.split('\n') : [], newline }
}

function withinDistance(left: string, right: string, max: number): boolean {
  if (Math.abs(left.length - right.length) > max) return false
  const previous = new Array<number>(right.length + 1)
  const next = new Array<number>(right.length + 1)
  for (let column = 0; column <= right.length; column += 1) previous[column] = column
  for (let row = 1; row <= left.length; row += 1) {
    next[0] = row
    let rowMin = next[0] ?? row
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1
      const value = Math.min((previous[column] ?? 0) + 1, (next[column - 1] ?? 0) + 1, (previous[column - 1] ?? 0) + cost)
      next[column] = value
      if (value < rowMin) rowMin = value
    }
    if (rowMin > max) return false
    for (let column = 0; column <= right.length; column += 1) previous[column] = next[column] ?? 0
  }
  return (previous[right.length] ?? max + 1) <= max
}

function linesClose(left: string, right: string): boolean {
  if (!left || !right || left === right) return false
  if (left.length < 8 || right.length < 8 || Math.max(left.length, right.length) > 240) return false
  const max = Math.floor(Math.max(left.length, right.length) * 0.34)
  return max > 0 && withinDistance(left, right, max)
}

function alignmentScore(window: string[], snippet: string[]): number {
  let index = 0
  let score = 0
  for (const line of snippet) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const current = window[index]?.trim() ?? ''
    if (current === trimmed || linesClose(current, trimmed)) {
      score += current === trimmed ? 1 : 0.65
      index += 1
      continue
    }
    let found = -1
    for (let look = index + 1; look < Math.min(window.length, index + 4); look += 1) {
      if ((window[look]?.trim() ?? '') === trimmed) {
        found = look
        break
      }
    }
    if (found < 0) continue
    score += 1
    index = found + 1
  }
  return score
}

function withFileIndent(oldLines: string[], newLines: string[]): string[] {
  const oldIndent = oldLines.find((line) => line.trim())?.match(/^\s*/)?.[0] ?? ''
  const newIndent = newLines.find((line) => line.trim())?.match(/^\s*/)?.[0] ?? ''
  if (oldIndent === newIndent) return newLines
  return newLines.map((line) => {
    if (!line.trim()) return ''
    const body = line.startsWith(newIndent) ? line.slice(newIndent.length) : line.trim()
    return `${oldIndent}${body}`
  })
}

export function snippetToEdit(fileText: string, snippet: string): { oldText: string; newText: string } | null {
  const file = splitLines(fileText)
  const proposal = splitLines(snippet)
  if (!proposal.lines.length || proposal.lines.length > 180 || !file.lines.length) return null
  const newText = proposal.lines.join(file.newline)
  if (fileText.includes(newText)) return null

  const meaningful = proposal.lines.filter((line) => line.trim()).length
  if (!meaningful) return null

  if (proposal.lines.length === 1) {
    const wanted = proposal.lines[0]?.trim() ?? ''
    const hits = file.lines
      .map((line, index) => ({ line, index }))
      .filter((item) => linesClose(item.line.trim(), wanted))
    if (hits.length !== 1) return null
    const oldText = hits[0]?.line ?? ''
    return oldText ? { oldText, newText: proposal.lines[0] ?? '' } : null
  }

  let best: { start: number; end: number; score: number } | null = null
  let rival = false
  const minLength = Math.max(1, proposal.lines.length - 3)
  const maxExtra = 3
  for (let start = 0; start < file.lines.length; start += 1) {
    const maxLength = Math.min(file.lines.length - start, proposal.lines.length + maxExtra)
    for (let length = minLength; length <= maxLength; length += 1) {
      const score = alignmentScore(file.lines.slice(start, start + length), proposal.lines)
      if (!best || score > best.score || (score === best.score && length < best.end - best.start)) {
        if (!best || score > best.score) rival = false
        else if (Math.abs(start - best.start) > 2) rival = true
        best = { start, end: start + length, score }
      } else if (best && score >= best.score - 0.05 && Math.abs(start - best.start) > 2) rival = true
    }
  }
  const need = Math.max(2, meaningful * 0.55)
  if (!best || best.score < need || rival) return null
  const oldLines = file.lines.slice(best.start, best.end)
  if (oldLines.length === proposal.lines.length && oldLines.every((line, index) => line.trim() === (proposal.lines[index]?.trim() ?? ''))) return null
  const rewritten = withFileIndent(oldLines, proposal.lines)
  const oldText = oldLines.join(file.newline)
  const rewrittenText = rewritten.join(file.newline)
  if (!oldText || oldText === rewrittenText) return null
  return { oldText, newText: rewrittenText }
}
