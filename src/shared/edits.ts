export interface SnippetEdit {
  path: string
  oldText: string
  newText: string
}

const sourcePath = /(?<![A-Za-z0-9_./-])((?:[A-Za-z0-9_.@-]+[\\/])+[A-Za-z0-9_.@-]+\.[A-Za-z0-9]+)(?![A-Za-z0-9_./-])/g

function lastPath(text: string): string {
  let found = ''
  for (const match of text.matchAll(sourcePath)) found = match[1] ?? found
  return found.replace(/\\/g, '/')
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

export function describedSnippets(visible: string): Array<{ path: string; snippet: string }> {
  const items: Array<{ path: string; snippet: string }> = []
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  let cursor = 0
  while ((match = fence.exec(visible))) {
    const header = match[1] ?? ''
    if (/^tool\b/i.test(header.trim())) {
      cursor = match.index + match[0].length
      continue
    }
    const before = visible.slice(cursor, match.index)
    const snippet = (match[2] ?? '').replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '')
    cursor = match.index + match[0].length
    const path = lastPath(header) || lastPath(before) || lastPath(visible.slice(0, match.index))
    if (!path || snippet.trim().length < 8) continue
    items.push({ path, snippet })
  }
  return items
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
