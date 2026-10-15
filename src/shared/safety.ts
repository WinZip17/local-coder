import path from 'node:path'

export function projectKey(projectPath: string): string {
  const resolved = path.resolve(projectPath).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function isGitCommand(command: string): boolean {
  const tokens = command.split(/[\s"'`;&|<>()]+/)
  return tokens.some((token) => {
    const name = token.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase()
    return name === 'git'
  })
}

export function resolveInsideProject(projectRoot: string, userPath: string): string {
  if (!userPath.trim()) throw new Error('Пустой путь.')
  const root = path.resolve(projectRoot)
  const target = path.resolve(root, userPath)
  const relative = path.relative(root, target)
  if (relative === '') return root
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Путь выходит за пределы проекта.')
  }
  const parts = relative.split(path.sep)
  if (parts.includes('.git')) throw new Error('Каталог .git недоступен. Репозиторием управляете вы.')
  return target
}
