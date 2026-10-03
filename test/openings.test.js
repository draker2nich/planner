'use strict';
/* Свободное место для проёма на стене: fitOffset (public/js/editor/core/derive.js) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore, rect, doorAt, windowAt } = require('./helpers/editor-core.js');

const c = loadCore();
const fit = (width, desired, exclude) => c.ev(`fitOffset(D.W.get('w0'), ${width}, ${desired}, ${exclude})`);

test('пустая стена: желаемое положение сохраняется', () => {
  c.setProject(rect(5400, 3900));
  assert.equal(fit(800, 1000, 'null'), 1000);
});
test('пустая стена: прижатие к началу и к концу', () => {
  c.setProject(rect(5400, 3900));
  assert.equal(fit(800, -500, 'null'), 0);
  assert.equal(fit(800, 9999, 'null'), 4600);
});
test('результат округляется до целого миллиметра', () => {
  c.setProject(rect(5400, 3900));
  assert.equal(fit(800, 1000.6, 'null'), 1001);
});
test('проём шире стены → null', () => {
  c.setProject(rect(5400, 3900));
  assert.equal(fit(5401, 0, 'null'), null);
  assert.equal(fit(5400, 0, 'null'), 0, 'ровно во всю стену — помещается');
});
test('занятое место обходится: выбирается ближайший свободный промежуток', () => {
  c.setProject(rect(5400, 3900, { openings: [doorAt('d', 'w0', 2000, 1000)] }));
  assert.equal(fit(800, 2100, 'null'), 1200, 'ближе к левому промежутку');
  assert.equal(fit(800, 2600, 'null'), 3000, 'ближе к правому промежутку');
});
test('слишком узкий промежуток пропускается', () => {
  c.setProject(rect(5400, 3900, { openings: [doorAt('d1', 'w0', 500, 800), doorAt('d2', 'w0', 1800, 800)] }));
  assert.equal(fit(800, 1400, 'null'), 2600, 'между дверями 500 мм — окно 800 туда не входит');
  assert.equal(fit(400, 1400, 'null'), 1400, 'а проём 400 — входит');
});
test('нет места ни в одном промежутке → null', () => {
  c.setProject(rect(2000, 3900, { openings: [doorAt('d1', 'w0', 300, 800), doorAt('d2', 'w0', 1150, 800)] }));
  assert.equal(fit(400, 500, 'null'), null);
});
test('исключение одного проёма: он сам себе не мешает при перемещении', () => {
  c.setProject(rect(5400, 3900, { openings: [doorAt('d', 'w0', 2000, 1000)] }));
  assert.equal(fit(1000, 2100, "'d'"), 2100);
});
test('исключение набора проёмов (ряд окон двигается целиком)', () => {
  c.setProject(rect(5400, 3900, { openings: [windowAt('a', 'w0', 500), windowAt('b', 'w0', 2000), doorAt('d', 'w0', 4000, 800)] }));
  assert.equal(fit(2500, 600, "new Set(['a', 'b'])"), 600);
  assert.equal(fit(2500, 2000, "new Set(['a', 'b'])"), 1500, 'ряд упирается в дверь');
});
test('проёмы других стен не учитываются', () => {
  c.setProject(rect(5400, 3900, { openings: [doorAt('d', 'w2', 1000, 3000)] }));
  assert.equal(fit(800, 1500, 'null'), 1500);
});
