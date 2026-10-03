'use strict';
/* Производные данные: контур, площадь, нормали, углы (public/js/editor/core/derive.js) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore, rect, lshape, base, ring } = require('./helpers/editor-core.js');

const c = loadCore();
const walls = () => c.ev('[...D.W.values()].map(i => ({ id: i.w.id, len: i.len, nx: i.nx, ny: i.ny, horiz: i.horiz, ortho: i.ortho, mid: { x: (i.a.x + i.b.x) / 2, y: (i.a.y + i.b.y) / 2 }, ref: i.ref, rx: i.rx, ry: i.ry }))');
/* нормаль смотрит наружу: от центра комнаты */
const outward = (w, cx, cy) => (w.mid.x - cx) * w.nx + (w.mid.y - cy) * w.ny > 0;

test('прямоугольник: контур замкнут, площадь, периметр', () => {
  c.setProject(rect(5400, 3900));
  assert.equal(c.ev('P.closed'), true);
  assert.equal(c.ev('D.cycle.length'), 4);
  assert.equal(c.ev('Math.abs(D.area)'), 5400 * 3900);
  assert.deepEqual(walls().map((w) => w.len), [5400, 3900, 5400, 3900]);
});
test('прямоугольник: нормали стен смотрят наружу', () => {
  c.setProject(rect(5400, 3900));
  for (const w of walls()) assert.ok(outward(w, 2700, 1950), w.id);
});
test('обход в обратную сторону даёт те же площадь и наружные нормали', () => {
  c.setProject(rect(5400, 3900, {}, false));
  assert.equal(c.ev('Math.abs(D.area)'), 5400 * 3900);
  assert.equal(c.ev('P.closed'), true);
  for (const w of walls()) assert.ok(outward(w, 2700, 1950), w.id);
});
test('прямоугольник: все углы выпуклые, у каждой стены два выпуклых конца', () => {
  c.setProject(rect());
  assert.deepEqual(c.ev('[...D.convex.values()]'), [true, true, true, true]);
  assert.deepEqual(c.ev('P.walls.map(w => kOf(w.id))'), [2, 2, 2, 2]);
});
test('Г‑образная комната: площадь и один вогнутый угол', () => {
  c.setProject(lshape());
  assert.equal(c.ev('Math.abs(D.area)'), 21000000);
  assert.deepEqual(c.ev('[...D.convex].filter(([, v]) => !v).map(([id]) => id)'), ['v3']);
  assert.deepEqual(c.ev('P.walls.map(w => kOf(w.id))'), [2, 2, 1, 1, 2, 2], 'стены у вогнутого угла имеют один выпуклый конец');
});
test('Г‑образная комната: нормали наружу и после разворота обхода', () => {
  for (const reverse of [false, true]) {
    const p = lshape(); if (reverse) Object.assign(p, ring([[0, 5000], [3000, 5000], [3000, 3000], [5000, 3000], [5000, 0], [0, 0]]));
    c.setProject(p);
    /* точка чуть внутрь от середины стены должна быть в комнате, чуть наружу — вне её */
    const inside = c.ev('[...D.W.values()].map(i => { const m = { x: (i.a.x + i.b.x) / 2, y: (i.a.y + i.b.y) / 2 }; return [pointInPoly({ x: m.x - i.nx * 10, y: m.y - i.ny * 10 }, innerPoly()), pointInPoly({ x: m.x + i.nx * 10, y: m.y + i.ny * 10 }, innerPoly())]; })');
    for (const [inn, out] of inside) { assert.equal(inn, true); assert.equal(out, false); }
  }
});
test('незамкнутая цепочка: контура нет, степени вершин 1‑2‑2‑1', () => {
  const p = rect(); p.walls.pop();
  c.setProject(p);
  assert.equal(c.ev('P.closed'), false);
  assert.equal(c.ev('D.cycle'), null);
  assert.deepEqual(c.ev('[...D.deg.values()].sort()'), [1, 1, 2, 2]);
  assert.deepEqual(c.ev('freeVertices().map(v => v.id).sort()'), ['v0', 'v3']);
  assert.equal(c.ev('innerPoly()'), null);
});
test('пустой проект: нет стен, нет контура, площадь 0', () => {
  c.setProject(base({ vertices: [], walls: [] }));
  assert.deepEqual(c.ev('[P.closed, D.area, D.W.size]'), [false, 0, 0]);
});
test('горизонтальные и вертикальные стены помечаются ortho и horiz', () => {
  c.setProject(rect());
  assert.deepEqual(walls().map((w) => [w.ortho, w.horiz]), [[true, true], [true, false], [true, true], [true, false]]);
});
test('наклонная стена: не ortho, длина по теореме Пифагора', () => {
  c.setProject(base(ring([[0, 0], [3000, 0], [3000, 4000]])));
  const w = walls().find((x) => x.id === 'w2');
  assert.equal(w.ortho, false); assert.equal(w.len, 5000);
});
test('опорный конец стены — левый у горизонтальной, верхний у вертикальной', () => {
  c.setProject(rect(5400, 3900));
  const by = Object.fromEntries(walls().map((w) => [w.id, w]));
  assert.deepEqual(by.w0.ref, { id: 'v0', x: 0, y: 0 });
  assert.deepEqual(by.w2.ref, { id: 'v3', x: 0, y: 3900 }, 'нижняя стена идёт справа налево, опорный конец всё равно левый');
  assert.deepEqual(by.w1.ref, { id: 'v1', x: 5400, y: 0 });
  assert.deepEqual([by.w2.rx, by.w2.ry], [1, 0]);
});
test('wallOpenings возвращает проёмы стены по возрастанию отступа', () => {
  const p = rect(); p.openings = [{ id: 'b', wallId: 'w0', offset: 3000, width: 800 }, { id: 'a', wallId: 'w0', offset: 500, width: 800 }, { id: 'c', wallId: 'w1', offset: 100, width: 800 }];
  c.setProject(p);
  assert.deepEqual(c.ev("wallOpenings('w0').map(o => o.id)"), ['a', 'b']);
});
test('pointInPoly и polyCentroid', () => {
  c.setProject(lshape());
  assert.equal(c.ev('pointInPoly({ x: 1000, y: 1000 }, innerPoly())'), true);
  assert.equal(c.ev('pointInPoly({ x: 4000, y: 4000 }, innerPoly())'), false, 'вырез Г‑образной комнаты');
  c.setProject(rect(4000, 2000));
  assert.deepEqual(c.ev('polyCentroid(innerPoly())'), { x: 2000, y: 1000 });
  assert.equal(c.ev('distToWalls({ x: 2000, y: 500 })'), 500);
});
