import assert from 'node:assert/strict'
import test from 'node:test'
import { declaresFinished, impliedToolCall, pendingEditPath, statesPendingWork, toolAfterSilence } from './intent'

test('a promise to inspect the project becomes list_dir', () => {
  const samples = [
    'Генерация завершилась успешно. Проверю структуру проекта, затем заменю шаблонную страницу на нужную.',
    'Сначала проверю файлы, созданные генератором, и найду главный компонент страницы.',
    'Проверю структуру проекта и определю путь главного компонента.'
  ]
  for (const sample of samples) {
    assert.equal(impliedToolCall(sample)?.name, 'list_dir')
    assert.equal(impliedToolCall(sample)?.arguments.path, '.')
    assert.equal(statesPendingWork(sample), true)
  }
  assert.equal(impliedToolCall('Прочитаю `src/App.tsx` и заменю страницу.')?.name, 'read_file')
  assert.equal(impliedToolCall('Прочитаю `src/App.tsx` и заменю страницу.')?.arguments.path, 'src/App.tsx')
  assert.equal(impliedToolCall('Готово. Страница заменена.'), null)
  assert.equal(statesPendingWork('Готово. Страница заменена.'), false)
  assert.equal(declaresFinished('Проект полностью готов и собирается без ошибок.'), true)
  assert.equal(statesPendingWork('Готово. Теперь проверю сборку.'), true)
  assert.equal(impliedToolCall('Посмотрю содержимое `src`, чтобы определить существующий файл страницы.')?.arguments.path, 'src')
  assert.equal(impliedToolCall('Нужно прочитать `src/App.tsx` и заменить его точным фрагментом.')?.name, 'read_file')
  assert.equal(toolAfterSilence('list_dir .\ndir src\nfile package.json')?.arguments.path, 'src')
  assert.equal(toolAfterSilence('list_dir src\nfile App.tsx\nfile main.tsx')?.arguments.path, 'src/App.tsx')
  assert.equal(toolAfterSilence('read_file src/App.tsx: в файле 10 строк, смещение 40 за концом. Повтори чтение с offset 1.')?.arguments.offset, 1)
  assert.equal(pendingEditPath('`src/App.tsx` заменю минимальной стартовой страницей, убрав демонстрационные блоки Vite и React.'), 'src/App.tsx')
  assert.equal(impliedToolCall('`src/App.tsx` заменю минимальной стартовой страницей, убрав демонстрационные блоки Vite и React.'), null)
})
