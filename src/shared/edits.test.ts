import assert from 'node:assert/strict'
import test from 'node:test'
import { describedLineEdit, describedSnippets, snippetToEdit } from './edits'

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

test('an unrelated fragment is not applied', () => {
  const snippet = `export function Missing() {\n  return <div>Другой экран</div>\n}`
  assert.equal(snippetToEdit(buttonFile, snippet), null)
})
