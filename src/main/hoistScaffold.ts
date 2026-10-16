import { existsSync } from 'node:fs'
import { readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'

const SKIP = new Set(['.local-coder', '.git', '.idea', 'node_modules'])

export async function hoistScaffold(projectPath: string): Promise<string | null> {
  if (existsSync(path.join(projectPath, 'package.json'))) return null
  const entries = await readdir(projectPath, { withFileTypes: true }).catch(() => [])
  const candidates = entries
    .filter((entry) => entry.isDirectory() && !SKIP.has(entry.name) && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .filter((name) => existsSync(path.join(projectPath, name, 'package.json')))
  if (candidates.length !== 1) return null
  const name = candidates[0] ?? ''
  const source = path.join(projectPath, name)
  const inner = await readdir(source).catch(() => [])
  const replace = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'])
  const moved: string[] = []
  for (const item of inner) {
    const destination = path.join(projectPath, item)
    if (existsSync(destination) && !replace.has(item)) continue
    if (existsSync(destination)) await rm(destination, { recursive: true })
    await rename(path.join(source, item), destination)
    moved.push(item)
  }
  if (!existsSync(path.join(projectPath, 'package.json'))) return null
  const left = await readdir(source).catch(() => ['.'])
  if (left.length === 0) await rm(source, { recursive: true }).catch(() => undefined)
  return `Файлы генератора перенесены из ${name} в корень проекта: ${moved.join(', ')}.`
}
