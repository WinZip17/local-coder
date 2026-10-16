import assert from 'node:assert/strict'
import test from 'node:test'
import { componentSnippet, describedLineEdit, describedSnippets, replacementContent, snippetToEdit } from './edits'

const buttonFile = `export function Filters() {
  return (
    <Button icon={<ClearOutlined />} onClick={clearAllFilters}>
      Сбросить
    </Button>
  )
}
`

test('a shown button edit becomes old and new text', () => {
  const visible = 'В файле `src/components/news/NewsListFilters.tsx` кнопка станет такой:\n```tsx\n<Button icon={<ClearOutlined />} onClick={clearAllFilters} type="primary">\n  Сбросить\n</Button>\n```'
  const snippets = describedSnippets(visible)
  assert.equal(snippets[0]?.path, 'src/components/news/NewsListFilters.tsx')
  const edit = snippetToEdit(buttonFile, snippets[0]?.snippet ?? '')
  assert.match(edit?.oldText ?? '', /<Button icon=\{<ClearOutlined \/>\} onClick=\{clearAllFilters\}>/)
  assert.match(edit?.newText ?? '', /type="primary"/)
  assert.doesNotMatch(edit?.oldText ?? '', /type="primary"/)
})

test('an inserted enum line replaces the surrounding block', () => {
  const file = `export enum UserRole {\n  USER = 'user',\n  MODERATOR = 'moderator',\n  ADMIN = 'admin'\n}\n`
  const snippet = `export enum UserRole {\n  USER = 'user',\n  POLITIC = 'politic',\n  MODERATOR = 'moderator',\n  ADMIN = 'admin'\n}`
  const edit = snippetToEdit(file, snippet)
  assert.match(edit?.oldText ?? '', /USER = 'user'/)
  assert.doesNotMatch(edit?.oldText ?? '', /POLITIC/)
  assert.match(edit?.newText ?? '', /POLITIC = 'politic'/)
})

test('a fragment already in the file is not an edit', () => {
  const snippet = `<Button icon={<ClearOutlined />} onClick={clearAllFilters}>\n  Сбросить\n</Button>`
  assert.equal(snippetToEdit(buttonFile, snippet), null)
})

test('a described role deletion removes that enum line', () => {
  const file = `export enum UserRole {\n  USER = 'user',\n  MODERATOR = 'moderator',\n  ADMIN = 'admin'\n}\n`
  const visible = "Роль 'MODERATOR' успешно удалена из 'UserRole'.\n1. Удалён элемент 'MODERATOR' = 'moderator' из enum 'UserRole'"
  const edit = describedLineEdit([{ path: 'src/enums.ts', text: file }], 'удали роль MODERATOR', visible)
  assert.equal(edit?.path, 'src/enums.ts')
  assert.match(edit?.oldText ?? '', /MODERATOR = 'moderator',/)
  assert.equal(edit?.newText, '')
  assert.equal(describedLineEdit([
    { path: 'src/enums.ts', text: file },
    { path: 'src/copy.ts', text: file }
  ], 'удали роль MODERATOR', visible), null)
})

test('new react files are taken from path comments and package.json', () => {
  const visible = [
    'Файлы:',
    '```typescript',
    '// src/App.tsx',
    'export default function App() { return <h1>Привет, я родился</h1> }',
    '```',
    '```css',
    '/* src/style.css */',
    '.container { text-align: center; }',
    '```',
    '```json',
    '{ "name": "app", "scripts": { "start": "vite" }, "dependencies": { "react": "^18.2.0" } }',
    '```'
  ].join('\n')
  const snippets = describedSnippets(visible)
  assert.deepEqual(snippets.map((item) => item.path), ['src/App.tsx', 'src/style.css', 'package.json'])
  assert.equal(snippets[0]?.snippet.includes('// src/App.tsx'), false)
  assert.match(snippets[0]?.snippet ?? '', /Привет, я родился/)
  assert.equal(snippets[1]?.snippet.includes('style.css'), false)
})

test('a shown README is written to README.md', () => {
  const visible = '```markdown\n# Привет, я родился\n\nОдна страница с двумя кнопками.\n\n## Запуск\n\nnpm install\nnpm run dev\n```'
  const snippets = describedSnippets(visible, 'Обнови содержимое файла README.md')
  assert.equal(snippets[0]?.path, 'README.md')
  assert.match(snippets[0]?.snippet ?? '', /Привет, я родился/)
  const next = replacementContent('Обнови содержимое файла README.md', 'README.md', snippets[0]?.snippet ?? '', '# React + TypeScript + Vite\n')
  assert.match(next ?? '', /Привет, я родился/)
  assert.equal(replacementContent('что это за проект?', 'README.md', snippets[0]?.snippet ?? '', ''), null)
})

test('a full App component without a path is still the page', () => {
  const visible = `Изменил App.tsx.\n\`\`\`tsx\nimport { useState } from 'react';\n\nfunction App() {\n  const handleRefreshClick = () => {\n    window.location.reload();\n  };\n\n  return (\n    <div>\n      <h1>Привет, я родился</h1>\n      <button onClick={handleRefreshClick}>Обновить страницу</button>\n    </div>\n  );\n}\n\nexport default App;\n\`\`\``
  assert.match(componentSnippet(visible) ?? '', /Привет, я родился/)
  assert.equal(describedSnippets(visible).length, 0)
  assert.equal(componentSnippet('```tsx\nconst x = 1\n```'), null)
})

test('an unrelated fragment is not applied', () => {
  const snippet = `export function Missing() {\n  return <div>Другой экран</div>\n}`
  assert.equal(snippetToEdit(buttonFile, snippet), null)
})
