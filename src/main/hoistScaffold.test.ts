import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { hoistScaffold } from './hoistScaffold'

test('a single generated folder is lifted into the project root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'local-coder-hoist-'))
  try {
    await mkdir(path.join(root, '.local-coder'), { recursive: true })
    await writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":1}')
    const child = path.join(root, 'vite-project')
    await mkdir(path.join(child, 'src'), { recursive: true })
    await writeFile(path.join(child, 'package.json'), '{"name":"app"}')
    await writeFile(path.join(child, 'package-lock.json'), '{"lockfileVersion":3}')
    await writeFile(path.join(child, 'src', 'App.jsx'), 'export default function App() { return null }\n')
    const note = await hoistScaffold(root)
    assert.match(note ?? '', /vite-project/)
    assert.equal(await readFile(path.join(root, 'package.json'), 'utf8'), '{"name":"app"}')
    assert.equal(await readFile(path.join(root, 'package-lock.json'), 'utf8'), '{"lockfileVersion":3}')
    assert.equal(existsSync(path.join(root, 'src', 'App.jsx')), true)
    assert.equal(existsSync(child), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
