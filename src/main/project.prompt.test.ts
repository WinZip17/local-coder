import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSystemPrompt, systemPromptBudget } from './project'
import type { ProjectMap } from '../shared/types'

function map(): ProjectMap {
  return {
    version: 1,
    updatedAt: '2026-10-15T00:00:00.000Z',
    summary: 'Демонстрационный проект',
    summaryFromAgent: false,
    notes: ['заметка'],
    tree: Array.from({ length: 400 }, (_, index) => ({ path: `src/module-${index}/file.ts`, type: 'file' as const })),
    documents: Array.from({ length: 12 }, (_, index) => ({
      path: `docs/guide-${index}.md`,
      excerpt: 'А'.repeat(3500)
    }))
  }
}

test('system prompt stays inside the context budget and does not paste document text', () => {
  const prompt = buildSystemPrompt('D:/work/demo', map(), 8192)
  assert.ok(prompt.length <= systemPromptBudget(8192))
  assert.equal(prompt.includes('А'.repeat(200)), false)
  assert.match(prompt, /list_dir/)
  assert.match(prompt, /нет доступа к файловой системе/)
  assert.match(prompt, /официальным генератором/)
  assert.match(prompt, /Ненулевой код run_command/)
  assert.match(prompt, /Показано \d+ из 400/)
  assert.match(prompt, /docs\/guide-0\.md/)
})
