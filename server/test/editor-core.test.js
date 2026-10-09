'use strict';
/* Ядро редактора без браузера: повреждённый проект не роняет расчёт, сочетания клавиш не зависят от раскладки. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEditor, room, item } = require('./editor-helpers.js');

const E = loadEditor();
const plain = (v) => JSON.parse(JSON.stringify(v));

test('повреждённый проект очищается при загрузке и не роняет расчёт геометрии', () => {
  const P = room();
  P.walls.push({ id: 'ghost', a: 'v1', b: 'нет такой точки' }, null, 'строка', { id: 'loop', a: 'v2', b: 'v2' });
  P.vertices.push({ id: 'nan', x: NaN, y: 0 }, 42);
  P.openings.push({ id: 'o9', kind: 'door', wallId: 'ghost', offset: 0, width: 800 }, { id: 'o10', kind: 'door', wallId: 'top', offset: 'сто', width: 800 });
  P.furniture = [item(E, 'sofa', { id: 'ok', x: 1000, y: 1000 }), { id: 'bad-type', typeId: 'нет такого типа', dims: {}, x: 1, y: 1 }, { id: 'no-dims', typeId: 'sofa', x: 1, y: 1 }, null];
  P.viewport = { x: 0, y: 0, zoom: 0 }; P.mode = 'что-то'; P.closed = true;
  const out = E.call('normalizeProject', P);
  assert.deepEqual(plain(out.walls.map((w) => w.id)), ['top', 'right', 'bottom', 'left']);
  assert.deepEqual(plain(out.vertices.map((v) => v.id)), ['v1', 'v2', 'v3', 'v4']);
  assert.deepEqual(plain(out.openings.map((o) => o.id)), ['o1', 'o2']);
  assert.deepEqual(plain(out.furniture.map((f) => f.id)), ['ok']);
  assert.deepEqual([out.viewport.zoom > 0, out.mode, out.closed], [true, 'walls', false], 'контур с выпавшей стеной не считается замкнутым');
  const D = E.call('derive', out);
  assert.equal(D.W.size, 4, 'геометрия считается');
});

test('целый проект очистка не меняет', () => {
  const P = room(); P.furniture = [item(E, 'sofa', { id: 's1', x: 1500, y: 900 })]; P.closed = true;
  const before = plain(P);
  assert.equal(E.call('sanitizeProject', P), 0);
  for (const k of ['vertices', 'walls', 'openings', 'furniture', 'closed']) assert.deepEqual(plain(P[k]), before[k], k);
});

test('сочетания клавиш: в русской раскладке клавиша берётся по месту, в латинских — по символу', () => {
  const key = (e) => E.call('keyOf', e);
  assert.equal(key({ key: 'я', code: 'KeyZ' }), 'z', 'Ctrl+Я — это Ctrl+Z');
  assert.equal(key({ key: 'Я', code: 'KeyZ' }), 'z');
  assert.equal(key({ key: 'ц', code: 'KeyW' }), 'w');
  assert.equal(key({ key: 'щ', code: 'KeyO' }), 'o');
  assert.equal(key({ key: 'z', code: 'KeyY' }), 'z', 'немецкая раскладка: символ важнее места');
  assert.equal(key({ key: 'A', code: 'KeyQ' }), 'a', 'AZERTY');
  assert.equal(key({ key: 'Escape', code: 'Escape' }), 'escape');
  assert.equal(key({ key: 'ArrowLeft', code: 'ArrowLeft' }), 'arrowleft');
  assert.equal(key({ key: '0', code: 'Digit0' }), '0');
  assert.equal(key({ key: 'ё', code: 'Backquote' }), 'ё', 'клавиша без латинской буквы остаётся как есть');
});

test('каталог: без сервера — демо‑набор; проверка мебели находит товар по идентификатору', () => {
  assert.equal(E.ev('CATALOG_SOURCE'), 'demo', 'страница открыта файлом — демо‑набор');
  assert.ok(E.ev('PRODUCTS.length') > 0);
  const pr = plain(E.ev('PRODUCTS.find(p=>p.typeId==="sofa"&&p.formId==="straight")'));
  const P = room(); P.closed = true;
  const f = item(E, 'sofa', { id: 's1', x: 2500, y: 2500, productId: pr.id, dims: { ...pr.dims, W: pr.dims.W + 300 } });
  P.furniture = [f]; P._strict = ['s1'];
  assert.match(String(E.call('validateFurniture', P, E.call('derive', P))), /размеры товара фиксированы/);
});
