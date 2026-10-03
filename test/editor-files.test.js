'use strict';
/* Целостность разбиения редактора на файлы (ТЗ этапа 2, раздел 9) */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadCore, CORE_FILES, PUBLIC } = require('./helpers/editor-core.js');

const html = fs.readFileSync(path.join(PUBLIC, 'editor.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const local = scripts.filter((s) => !/^https?:/.test(s));
const editor = local.filter((s) => s.startsWith('js/editor/'));

test('editor.html подключает файлы редактора, встроенного кода редактора в нём нет', () => {
  assert.ok(editor.length >= 20, `подключено ${editor.length}`);
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(inline.length, 1, 'остаётся только скрипт темы');
  assert.ok(inline[0].length < 400 && inline[0].includes('planner.theme'));
  assert.ok(!/<style[\s>]/.test(html), 'стили вынесены в editor.css');
  assert.ok(Buffer.byteLength(html) <= 12 * 1024, `editor.html ${Buffer.byteLength(html)} байт`);
});
test('каждый подключённый файл существует и разбирается без синтаксических ошибок', () => {
  for (const s of local) {
    const file = path.join(PUBLIC, s);
    assert.ok(fs.existsSync(file), s);
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(file, 'utf8'), { filename: s }), s);
  }
  assert.ok(fs.existsSync(path.join(PUBLIC, 'js/editor/editor.css')));
});
test('каждый файл из public/js/editor подключён в editor.html', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const onDisk = walk(path.join(PUBLIC, 'js/editor')).filter((f) => f.endsWith('.js')).map((f) => path.relative(PUBLIC, f).split(path.sep).join('/')).sort();
  assert.deepEqual(onDisk, editor.slice().sort());
});
test('файлы редактора — обычные скрипты в строгом режиме, без import и export', () => {
  for (const s of editor) {
    const src = fs.readFileSync(path.join(PUBLIC, s), 'utf8');
    assert.ok(src.startsWith("'use strict';"), s);
    assert.ok(!/^\s*(import|export)\s/m.test(src), s);
  }
});
test('порядок подключения: ядро в порядке зависимостей, раньше интерфейса; запуск и аккаунт — последними', () => {
  const core = CORE_FILES.filter((f) => f.startsWith('js/editor/core/'));
  const idx = core.map((f) => local.indexOf(f));
  assert.ok(idx.every((i) => i >= 0), 'все файлы ядра подключены');
  assert.deepEqual(idx, idx.slice().sort((a, b) => a - b), 'порядок ядра совпадает с порядком в тестовом помощнике');
  const firstUi = local.findIndex((s) => s.startsWith('js/editor/ui/'));
  assert.ok(Math.max(...idx) < firstUi);
  assert.ok(local.indexOf('shared/catalog-types.js') < idx[0]);
  assert.deepEqual(editor.slice(-2), ['js/editor/boot.js', 'js/editor/account.js']);
});
test('ядро загружается в чистом контексте: при загрузке нет обращений к document, window, localStorage', () => {
  assert.doesNotThrow(() => loadCore({ bare: true }));
});
test('в файлах ядра нет обращений к странице вне тел функций', () => {
  /* грубая проверка верхнего уровня: строки без отступа, не начинающиеся с объявления функции */
  for (const f of CORE_FILES.filter((x) => x.startsWith('js/editor/'))) {
    const top = fs.readFileSync(path.join(PUBLIC, f), 'utf8').split('\n').filter((l) => /^(const|let|var|[A-Za-z_$][\w$.]*\s*[=(])/.test(l) && !/^(async\s+)?function\b/.test(l));
    for (const l of top) assert.ok(!/\b(document|window|localStorage|matchMedia|navigator)\s*[.(\[]/.test(l.replace(/=>.*$/, '').replace(/function.*$/, '')), `${f}: ${l.slice(0, 80)}`);
  }
});
test('функции ядра определены ровно один раз', () => {
  const names = new Map();
  for (const s of editor) {
    for (const m of fs.readFileSync(path.join(PUBLIC, s), 'utf8').matchAll(/^(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/gm)) names.set(m[1], [...(names.get(m[1]) || []), s]);
  }
  const dup = [...names].filter(([, files]) => files.length > 1).map(([n, files]) => `${n}: ${files.join(', ')}`);
  assert.deepEqual(dup, []);
});
