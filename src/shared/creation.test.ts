import assert from 'node:assert/strict'
import test from 'node:test'
import { commandAlreadySucceeded, commandFailed, commandFromCreationAnswer, creationQuestion, dependenciesInstalled, generatorSucceeded, isCreateReactApp, isDevServerCommand, isDirectoryChange, isProjectCreationRequest, isProjectInstall, outputLooped, removesLocalCoder, scaffoldInCurrentFolder, shouldAskCreationChoice } from './creation'

test('project creation is detected for any stack', () => {
  assert.equal(isProjectCreationRequest('создай проект на react'), true)
  assert.equal(isProjectCreationRequest('создать проект на vue'), true)
  assert.equal(isProjectCreationRequest('перекрась кнопку'), false)
})

test('a failed command is not a finished answer', () => {
  assert.equal(commandFailed('run_command npx ts-node src/App.tsx\nTypeError: Cannot read properties\nПроцесс завершился с кодом 1.'), true)
  assert.equal(commandFailed('run_command npm test\nok\nПроцесс завершился с кодом 0.'), false)
  assert.equal(commandFailed('run_command npx create-vite .\nOperation cancelled\nПроцесс завершился с кодом 0.'), true)
  assert.equal(commandFailed('edit_file src/App.tsx: заменено 1 фрагмент(ов).'), false)
})

test('a finished generator still needs the page edit', () => {
  const output = 'run_command npx create-vite . --template react-ts\nDone.\nПроцесс завершился с кодом 0.'
  assert.equal(generatorSucceeded(output), true)
  assert.equal(generatorSucceeded('run_command npx create-vite .\nOperation cancelled\nПроцесс завершился с кодом 0.'), false)
})

test('a generator command lands in the current folder', () => {
  assert.equal(
    scaffoldInCurrentFolder('npx create-vite@latest --template react --project-name react-greeting --overwrite'),
    'npx create-vite@latest . --template react --project-name react-greeting --overwrite'
  )
  assert.equal(
    scaffoldInCurrentFolder('npx create-vite@latest vite-project --template react'),
    'npx create-vite@latest . --template react --overwrite'
  )
  assert.equal(
    scaffoldInCurrentFolder('npx --yes create-vite@latest . --template react'),
    'npx --yes create-vite@latest . --template react --overwrite'
  )
  assert.equal(scaffoldInCurrentFolder('npm create vite@latest my-app -- --template react'), 'npm create vite@latest . -- --template react')
  assert.equal(scaffoldInCurrentFolder('npm install'), null)
  assert.equal(
    scaffoldInCurrentFolder('npx create-react-app . --overwrite После установки заменю содержимое'),
    'npx create-react-app . --overwrite'
  )
  assert.equal(scaffoldInCurrentFolder('npx create-react-app . --overwrite . . . . . .'), 'npx create-react-app . --overwrite')
  assert.equal(isDirectoryChange('cd vite-project'), true)
  assert.equal(isDevServerCommand('npm run dev'), true)
  assert.equal(isDevServerCommand('npm install'), false)
  assert.equal(removesLocalCoder('rm -rf .local-coder'), true)
  assert.equal(removesLocalCoder('mv .local-coder .local-coder-backup'), true)
  assert.equal(removesLocalCoder('npm install'), false)
  assert.equal(isCreateReactApp('npx create-react-app .'), true)
  assert.equal(isCreateReactApp('npx create-vite@latest . --template react-ts --overwrite'), false)
})

test('a numbered creation answer becomes the generator command', () => {
  const question = `Какой способ создания выбрать?

1. **Vite + React + TypeScript**
2. **Vite + React + JavaScript**
3. **Create React App + JavaScript**`
  assert.equal(commandFromCreationAnswer(question, '1'), 'npx create-vite@latest . --template react-ts --overwrite')
  assert.equal(commandFromCreationAnswer(question, '2'), 'npx create-vite@latest . --template react --overwrite')
  assert.equal(commandFromCreationAnswer(question, '3'), 'npx create-react-app .')
  assert.equal(commandFromCreationAnswer('1) npx create-vite@latest . --template react-ts --overwrite', '1'), 'npx create-vite@latest . --template react-ts --overwrite')
  const inline = 'Каким генератором создавать React-проект? Варианты: 1) Vite + TypeScript (npx create-vite@latest . --template react-ts --overwrite) — рекомендую; 2) Vite + JavaScript (npx create-vite@latest . --template react --overwrite); 3) Create React App (npx create-react-app .)'
  assert.equal(commandFromCreationAnswer(inline, '1'), 'npx create-vite@latest . --template react-ts --overwrite')
})

test('a command that already exited 0 is not requested again', () => {
  const install = 'run_command npm install\nadded 27 packages\n\nfound 0 vulnerabilities\nПроцесс завершился с кодом 0.'
  const build = 'run_command npm run build\nbuilt in 136ms\nПроцесс завершился с кодом 0.'
  assert.equal(commandAlreadySucceeded([install, build], 'npm install'), true)
  assert.equal(commandAlreadySucceeded([install, build], 'npm run build'), true)
  assert.equal(commandAlreadySucceeded([install], 'npm run dev'), false)
  assert.equal(commandAlreadySucceeded(['run_command npm install\nnpm ERR!\nПроцесс завершился с кодом 1.'], 'npm install'), false)
  assert.equal(commandAlreadySucceeded([`${install}\n\n${build}`], 'npm run build'), true)
})

test('dev before a plain install is not ready', () => {
  const generated = 'run_command npx create-vite@latest . --template react-ts --overwrite\nDone.\nПроцесс завершился с кодом 0.'
  const dev = 'run_command npm run dev\nCannot find package\nПроцесс завершился с кодом 1.'
  const onePackage = 'run_command npm install @vitejs/plugin-react\nadded 1 package\nПроцесс завершился с кодом 0.'
  const install = 'run_command npm install\nadded 27 packages\nПроцесс завершился с кодом 0.'
  assert.equal(isProjectInstall('npm install'), true)
  assert.equal(isProjectInstall('npm install @vitejs/plugin-react'), false)
  assert.equal(isDevServerCommand('npm run dev'), true)
  assert.equal(dependenciesInstalled([generated, dev]), false)
  assert.equal(dependenciesInstalled([generated, onePackage]), false)
  assert.equal(dependenciesInstalled([generated, install]), true)
  assert.equal(dependenciesInstalled(['run_command npm test\nПроцесс завершился с кодом 0.']), true)
  const loop = Array.from({ length: 6 }, () => '✓ 12 modules loaded\n✓ 12 modules reloaded\n✓ 12 modules invalidated').join('\n')
  assert.equal(outputLooped(loop), true)
  assert.equal(outputLooped('added 27 packages\nПроцесс завершился с кодом 0.'), false)
})

test('an empty React choice still becomes the Vite TypeScript command', () => {
  const visible = 'Проект пустой, поэтому его нужно создать генератором. Уточню вариант:'
  const question = creationQuestion('создай простой проект на react', visible)
  assert.match(question ?? '', /react-ts/)
  assert.equal(commandFromCreationAnswer(question ?? '', '1'), 'npx create-vite@latest . --template react-ts --overwrite')
  assert.equal(creationQuestion('создай проект на react', 'Сначала посмотрю файлы'), null)
  assert.equal(shouldAskCreationChoice(visible), false)
})

test('creation options in prose must go through ask_user', () => {
  const visible = 'Можно npx create-vite или npx create-react-app. Какой способ выбрать?'
  assert.equal(shouldAskCreationChoice(visible), true)
  assert.equal(shouldAskCreationChoice('Страница готова.'), false)
})
