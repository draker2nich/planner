/* Геометрия помещения (ТЗ §13, автотест А10): любые простые многоугольники, зоны на косых стенах */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers.js');
const R = require('../../public/shared/ai-room.js');
const G = require('../../public/shared/geometry.js');
const FIX = require('./fixtures/index.js');

const TOL = 2;
const inside = (room, p) => G.pointInPoly(p, room.poly);

test('все фикстуры: контур читается, нормали смотрят внутрь, зоны внутри комнаты', () => {
  for (const fx of FIX) {
    const room = R.buildRoom(fx.project);
    assert.ok(room.area >= 1e6, fx.id);
    for (const w of room.walls) {
      const m = w.point(w.len / 2, 50); assert.ok(inside(room, m), `${fx.id} ${w.label}: нормаль внутрь`);
      assert.ok(Math.abs(Math.hypot(w.u.x, w.u.y) - 1) < 1e-9 && Math.abs(w.u.x * w.n.x + w.u.y * w.n.y) < 1e-9);
      for (const o of w.openings) { const [t0, t1] = [o.t0, o.t1]; assert.ok(t0 >= -TOL && t1 <= w.len + TOL, `${fx.id}: проём на стене`); assert.ok(Math.abs(w.offsetOf(t0, t1 - t0) - fx.project.openings.find(x => x.id === o.id).offset) < 1e-6, 'offset ↔ t'); }
    }
    for (const z of [...room.zones.entry, ...room.zones.window]) { const c = z.pts.reduce((s, p) => ({ x: s.x + p.x / 4, y: s.y + p.y / 4 }), { x: 0, y: 0 }); assert.ok(inside(room, c), `${fx.id}: зона ${z.id} внутри`); }
    for (const z of room.zones.doorSwing) { const c = z.pts.reduce((s, p) => ({ x: s.x + p.x / z.pts.length, y: s.y + p.y / z.pts.length }), { x: 0, y: 0 }); assert.ok(inside(room, c), `${fx.id}: открывание двери внутрь`); }
    const sumAngles = room.corners.reduce((s, c) => s + c.angle, 0);
    assert.ok(Math.abs(sumAngles - (room.corners.length - 2) * 180) < 0.5, `${fx.id}: сумма углов многоугольника`);
    const regArea = room.regions.reduce((s, g) => s + g.area, 0); assert.ok(Math.abs(regArea - room.area) < 1, `${fx.id}: области покрывают комнату`);
  }
});

test('углы и области: шестиугольник, трапеция, Г-образная, короб', () => {
  const hex = R.buildRoom(FIX.byId('hexagon').project);
  assert.ok(hex.corners.every(c => Math.abs(c.angle - 120) < 0.5 && c.inner)); assert.strictEqual(hex.regions.length, 1); assert.strictEqual(hex.axes.length, 3);
  const tr = R.buildRoom(FIX.byId('trapezoid-1').project); const angles = tr.corners.map(c => Math.round(c.angle)).sort((a, b) => a - b);
  assert.deepStrictEqual(angles, [60, 90, 90, 120]);
  const L = R.buildRoom(FIX.byId('L-5x5').project); assert.strictEqual(L.regions.length, 2); assert.strictEqual(L.corners.filter(c => !c.inner).length, 1);
  const box = R.buildRoom(FIX.byId('protrusion').project); assert.strictEqual(box.corners.filter(c => c.angle > 180).length, 2);
});

test('вход: самая широкая дверь; без дверей — середина длинной стены без окна', () => {
  const three = R.buildRoom(FIX.byId('three-doors').project); assert.strictEqual(three.entrance.openingId, three.project.openings.find(o => o.kind === 'door' && o.width === 900).id);
  const none = R.buildRoom(FIX.byId('no-door').project); assert.ok(none.entrance.assumed); assert.ok(!none.W.get(none.entrance.wallId).hasWindow);
  assert.ok(none.zones.entry.some(z => z.assumed));
});

test('французское окно — зона 600 мм; селекторы стен', () => {
  const r = R.buildRoom(FIX.byId('arch-french').project);
  const fr = r.zones.window.find(z => z.french); assert.ok(fr); const w = r.W.get(fr.wallId);
  const depth = Math.abs((fr.pts[2].x - fr.pts[1].x) * w.n.x + (fr.pts[2].y - fr.pts[1].y) * w.n.y); assert.ok(Math.abs(depth - 600) < 1);
  assert.ok(R.resolveWall(r, 'with_window', {}).length === 2);
  assert.ok(R.resolveWall(r, 'longest', {}).length === 1);
  assert.strictEqual(R.resolveWall(r, 'adjacent_to:W1', {}).length, 2);
  assert.deepStrictEqual(R.resolveWall(r, 'W3', {}).map(w => w.label), ['W3']);
});

test('сетка: площадь по клеткам совпадает с площадью, поле расстояний и ширина прохода', () => {
  const p = H.rect(3000, 5000); H.door(p, 3, 1100, 800); H.door(p, 1, 1100, 800);
  const room = R.buildRoom(p); const g = R.makeGrid(room); const n = g.inside.reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(n * g.c * g.c - room.area) / room.area < 0.02);
  const blocked = new Uint8Array(g.nx * g.ny); R.rasterize(g, [{ x: 0, y: 2000 }, { x: 2400, y: 2000 }, { x: 2400, y: 2600 }, { x: 0, y: 2600 }], blocked);
  const dist = R.distanceField(g, blocked); const starts = R.cellsOf(g, room.zones.entry[0].pts);
  const best = R.widestMap(g, dist, starts); let m = 0; for (const k of R.cellsOf(g, room.zones.entry[1].pts)) m = Math.max(m, best[k]);
  assert.ok(Math.abs(2 * m + g.c - 600) <= g.c, `проход ≈ 600 мм, получено ${2 * m + g.c}`);
});

test('ошибки контура: не замкнут, самопересечение, меньше 1 м²', () => {
  const open = H.rect(3000, 3000); open.walls.pop(); assert.throws(() => R.buildRoom(open), e => e.code === 'geometry_invalid');
  const bow = H.room([[0, 0], [3000, 3000], [3000, 0], [0, 3000]]); assert.throws(() => R.buildRoom(bow), e => e.code === 'geometry_invalid');
  assert.throws(() => R.buildRoom(H.rect(900, 900)), e => e.code === 'geometry_invalid');
});
