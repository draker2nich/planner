'use strict';
/* newProject и normalizeProject (public/js/editor/core/state.js) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore, rect, windowAt } = require('./helpers/editor-core.js');

const c = loadCore();
const norm = (p) => c.call('normalizeProject', p);

test('новый проект создаётся в миллиметрах, пустой и в режиме стен', () => {
  const p = c.ev('newProject()');
  assert.deepEqual([p.unit, p.mode, p.status, p.vertices.length, p.walls.length, p.wallHeight, p.wallThickness], ['mm', 'walls', 'draft', 0, 0, 2700, 150]);
  assert.ok(p.id && p.createdAt);
});
test('старый проект в сантиметрах остаётся в сантиметрах', () => {
  assert.equal(norm({ ...rect(), unit: 'cm' }).unit, 'cm');
  assert.equal(norm({ ...rect(), unit: 'ftin' }).unit, 'ftin');
});
test('пустой проект с сервера получает все поля', () => {
  const p = norm({ name: 'Спальня', unit: 'mm', vertices: [], walls: [], openings: [] });
  for (const k of ['id', 'wallHeight', 'wallThickness', 'seq', 'floor', 'eyeHeight', 'photos', 'mode', 'furniture', 'fseq', 'status', 'viewport', 'viewPointsVisible', 'lengthsIncludeThickness', 'wallParamsSet', 'showDims']) assert.ok(p[k] !== undefined && p[k] !== null, k);
  assert.equal(p.name, 'Спальня');
});
test('совсем пустой объект открывается без ошибок', () => {
  const p = norm({});
  assert.deepEqual([p.unit, p.vertices, p.walls, p.openings, p.furniture], ['mm', [], [], [], []]);
  c.setProject({}); assert.equal(c.ev('validateProject(P)'), null);
  assert.equal(c.ev('fmtU(1000)'), '1000 мм');
});
test('неизвестная единица заменяется на мм', () => assert.equal(norm({ ...rect(), unit: 'parsec' }).unit, 'mm'));
test('заданные значения не перезаписываются', () => {
  const p = norm({ ...rect(), wallHeight: 3000, wallThickness: 200, eyeHeight: 1500, mode: 'furniture', status: 'submitted', viewPointsVisible: false, viewport: { x: 5, y: 6, zoom: 0.2 } });
  assert.deepEqual([p.wallHeight, p.wallThickness, p.eyeHeight, p.mode, p.status, p.viewPointsVisible, p.viewport], [3000, 200, 1500, 'furniture', 'submitted', false, { x: 5, y: 6, zoom: 0.2 }]);
});
test('проект этапа 1 без рядов окон открывается и проходит проверку', () => {
  c.setProject(rect(5400, 3900, { openings: [windowAt('a', 'w0', 500), windowAt('b', 'w0', 2000)] }));
  assert.equal(c.ev('validateProject(P)'), null);
  assert.deepEqual(c.ev('P.openings.map(o => rowOf(o).length)'), [1, 1]);
});
test('состояние инструмента по умолчанию', () => assert.deepEqual(c.ev('[E.tool, E.mode, E.sel]'), ['select', 'idle', null]));
