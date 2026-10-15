import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { displayStream, parseModelOutput, shouldNudgeFileEdit } from './parse'
import { isGitCommand, projectKey, resolveInsideProject } from './safety'
import { defaultSettings, modelProblem, normalizeSettings } from './settings'

test('git commands are blocked and ordinary commands stay available', () => {
  assert.equal(isGitCommand('git status'), true)
  assert.equal(isGitCommand('git commit -m "save"'), true)
  assert.equal(isGitCommand('npm test && git push'), true)
  assert.equal(isGitCommand('"C:\\\\Program Files\\\\Git\\\\cmd\\\\git.exe" status'), true)
  assert.equal(isGitCommand('npm test'), false)
  assert.equal(isGitCommand('python main.py'), false)
  assert.equal(isGitCommand('echo hello'), false)
  assert.equal(isGitCommand('npx gitignore'), false)
})

test('paths stay inside the project and .git is closed', () => {
  const root = path.resolve('C:\\work\\demo')
  assert.equal(resolveInsideProject(root, 'src/app.ts'), path.join(root, 'src', 'app.ts'))
  assert.throws(() => resolveInsideProject(root, '../secret.txt'), /пределы проекта/)
  assert.throws(() => resolveInsideProject(root, 'src/../../outside.txt'), /пределы проекта/)
  assert.throws(() => resolveInsideProject(root, '.git/config'), /\.git/)
  assert.throws(() => resolveInsideProject(root, 'src/../.git/HEAD'), /\.git/)
})

test('one folder has one project key', () => {
  const folder = path.resolve('C:\\work\\Demo\\')
  assert.equal(projectKey(folder), projectKey(path.join(folder, '..', 'Demo')))
})

test('tool calls are separated from the visible answer', () => {
  const parsed = parseModelOutput(
    'Сначала прочитаю файл.\n<tool_call>\n{"name":"read_file","arguments":{"path":"README.md"}}\n</tool_call>'
  )
  assert.equal(parsed.visible, 'Сначала прочитаю файл.')
  assert.equal(parsed.calls.length, 1)
  assert.equal(parsed.calls[0]?.name, 'read_file')
  assert.equal(parsed.calls[0]?.arguments.path, 'README.md')
  assert.deepEqual(parsed.errors, [])
  assert.equal(displayStream('Ответ <tool_call>{"name":"list_dir"'), 'Ответ')
  const loose = parseModelOutput('ask_user\n{"question":"Какая кнопка?"}\n</tool_call>')
  assert.equal(loose.calls[0]?.name, 'ask_user')
  assert.equal(loose.calls[0]?.arguments.question, 'Какая кнопка?')
  assert.equal(loose.visible, '')
  assert.deepEqual(loose.errors, [])
})

test('a filesystem refusal is sent back to the tools', () => {
  const refusal = 'Я не могу создавать или изменять файлы, так как я текстовый AI и не имею доступа к файловой системе.'
  assert.equal(shouldNudgeFileEdit(refusal, 'почему ты не создала файлы в проекте?'), true)
  assert.equal(shouldNudgeFileEdit('Сначала посмотрите структуру.', 'создай компонент кнопки'), true)
  assert.equal(shouldNudgeFileEdit('Это новостной портал на React.', 'что это за проект?'), false)
})

test('the app stays closed until a model is selected', () => {
  assert.match(modelProblem(defaultSettings) ?? '', /Выберите тип модели/)
  const saved = normalizeSettings({
    activeProvider: 'openai',
    openai: { baseUrl: 'https://api.openai.com/v1/', apiKey: ' sk ', model: ' gpt-4.1 ' }
  })
  assert.equal(saved.openai.baseUrl, 'https://api.openai.com/v1')
  assert.equal(saved.openai.apiKey, 'sk')
  assert.equal(saved.openai.model, 'gpt-4.1')
  assert.equal(modelProblem(saved), null)
})
