'use strict';
/* Общая геометрия: те же функции работают в редакторе и на сервере. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const G = require('../public/shared/geometry.js');

const rect = (w, h) => ({
  wallHeight: 2700,
  vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: w, y: 0 }, { id: 'c', x: w, y: h }, { id: 'd', x: 0, y: h }],
  walls: [{ id: 'w0', a: 'a', b: 'b' }, { id: 'w1', a: 'b', b: 'c' }, { id: 'w2', a: 'c', b: 'd' }, { id: 'w3', a: 'd', b: 'a' }],
  openings: [], furniture: [],
});

test('sha256 совпадает с node:crypto, включая кириллицу и длинные строки', () => {
  for (const s of ['', 'abc', 'Диван Nord M', 'x'.repeat(1000), '😀 эмодзи', JSON.stringify({ a: [1, 2, 3], b: 'тест' }).repeat(50)]) {
    assert.equal(G.sha256(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
  }
});

test('отпечаток не зависит от названий, замков, порядка ключей и дробной части < 0,05 мм', () => {
  const p = rect(4000, 5000);
  p.furniture = [{ id: 'f1', typeId: 'sofa', formId: 'straight', productId: null, formAny: false, name: 'Диван 1', constraints: {}, dims: { W: 2200, D: 900, H: 850 }, x: 2000, y: 4545, rot: 180, mirror: false, locked: false, aiPolicy: 'free' }];
  const h1 = G.snapshotHash(p);
  const q = JSON.parse(JSON.stringify(p));
  q.furniture[0].name = 'Другой'; q.furniture[0].locked = true; q.name = 'Проект'; q.unit = 'mm';
  q.walls[0].material = { type: 'color', color: '#fff' };
  q.furniture[0].x = 2000.04;
  assert.equal(G.snapshotHash(q), h1);
  q.furniture[0].aiPolicy = 'keep';
  assert.notEqual(G.snapshotHash(q), h1, 'права входят в отпечаток');
  const r = JSON.parse(JSON.stringify(p)); r.furniture[0].x = 2010;
  assert.notEqual(G.snapshotHash(r), h1);
});

test('derive: нормали наружу, площадь и цикл у невыпуклого многоугольника', () => {
  const p = { vertices: [[0, 0], [6000, 0], [6000, 3000], [3000, 3000], [3000, 5000], [0, 5000]].map((v, i) => ({ id: 'v' + i, x: v[0], y: v[1] })), walls: [], openings: [], furniture: [] };
  p.walls = p.vertices.map((v, i) => ({ id: 'w' + i, a: v.id, b: p.vertices[(i + 1) % 6].id }));
  const d = G.derive(p);
  assert.equal(d.cycle.length, 6);
  assert.equal(Math.abs(d.area), 6000 * 3000 + 3000 * 2000);
  // нижняя стена y=0: нормаль наружу — вверх по экрану (y < 0)
  const w0 = d.W.get('w0'); assert.equal(Math.round(w0.ny), -1);
  // вершина v3 (3000,3000) — входящий угол
  assert.equal(d.convex.get('v3'), false);
  assert.equal(d.convex.get('v0'), true);
});

test('настенный предмет: тыл к стене, перед в комнату', () => {
  const p = rect(4000, 5000); const d = G.derive(p);
  const tv = { id: 't', typeId: 'tv', formId: 'wall', dims: { W: 1250, D: 80, H: 720, E: 1000 }, wallId: 'w1', offset: 1000, elev: 1000 };
  const fr = G.placementFrame(tv, d);
  assert.equal(Math.round(fr.x), 4000 - 40);
  const pts = G.fWorldOf(tv, p, d); const bb = G.aabbOf(pts);
  assert.ok(bb.x1 <= 4000 + 0.01 && bb.x0 >= 4000 - 80 - 0.01);
});

test('П4: настенные на одной стене конфликтуют, только если пересекаются по высоте', () => {
  const p = rect(4000, 5000); const d = G.derive(p);
  const tv = { id: 't', name: 'ТВ', typeId: 'tv', formId: 'wall', dims: { W: 1250, D: 80, H: 720, E: 1000 }, wallId: 'w1', offset: 1000, elev: 1000, x: 0, y: 0, rot: 0 };
  const shelf = { id: 's', name: 'Полка', typeId: 'wall-shelf', formId: 'wall', dims: { W: 800, D: 250, H: 30, E: 1500 }, wallId: 'w1', offset: 1200, elev: 1900, x: 0, y: 0, rot: 0 };
  p.furniture = [tv, shelf];
  assert.equal(G.validateFurniture(p, d), null);
  shelf.elev = 1500;
  assert.match(G.validateFurniture(p, d), /пересекает/);
});

test('heightInterval: на основании — от верха основания, потолочный — от потолка', () => {
  const p = rect(4000, 4000);
  const base = { id: 'b', typeId: 'nightstand', formId: 'rect', dims: { W: 450, D: 400, H: 500 } };
  const lamp = { id: 'l', typeId: 'table-lamp', formId: 'round', dims: { DIA: 250, H: 450 }, baseId: 'b' };
  const ch = { id: 'c', typeId: 'chandelier', formId: 'round', dims: { DIA: 600, H: 500 } };
  p.furniture = [base, lamp, ch];
  assert.deepEqual(G.heightInterval(lamp, p), [500, 950]);
  assert.deepEqual(G.heightInterval(ch, p), [2200, 2700]);
  assert.deepEqual(G.heightInterval(base, p), [0, 500]);
});
