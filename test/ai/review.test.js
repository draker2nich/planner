/* Регрессия по независимой проверке И1: сценарии, в которых раньше пропускалась негодная расстановка
   или терялись допустимые варианты */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers.js');
const R = require('../../public/shared/ai-room.js');
const AR = require('../../public/shared/ai-rules.js');
const S = require('../../server/ai/solver/index.js');
const { rect, room, door, win, item, atWall, onWall, freeAt, onBase, add, clone, productById } = H;
const solve = (p, relations = [], task = {}) => S.solveConcept(S.prepare(p, H.PRODUCTS, { budget: { mode: 'none' }, ...task }), { key: 'c', relations }, { seed: 1 });
const keys = (v) => v.violations.map(x => AR.vkey(x) + (x.inherited ? '*' : ''));

test('Ж10: унаследованная помеха неподвижных узнаётся, даже если перемещаемый предмет убрали', () => {
  H.resetIds(); const p = rect(4000, 4000); door(p, 3, 300, 800);
  const ward = atWall(p, item('wardrobe', { id: 'ward', product: 'p-wardrobe-rect-M', policy: 'keep' }), 1, 2000, 0);
  const arm = freeAt(item('armchair', { id: 'arm', product: 'p-armchair-rect-S', policy: 'free' }), 1500, 950, 0);
  const ch = freeAt(item('chair', { id: 'ch', product: 'p-chair-rect-S', policy: 'keep' }), 2500, 900, 0);
  add(p, arm, ward, ch);
  const q = clone(p); Object.assign(q.furniture[0], { x: 1000, y: 3000 });
  const v = AR.validate(q, { original: p, productById }); assert.ok(v.ok, keys(v).join(' '));
  assert.ok(solve(p).solutions.length > 0);
  // и наоборот: перемещаемый предмет, добавленный к уже нарушенной зоне, — новое нарушение
  const w = clone(p); Object.assign(w.furniture[0], { x: 1500, y: 950 }); w.furniture[0].aiPolicy = 'free';
  const q2 = clone(p); q2.furniture.splice(0, 1); q2.furniture.push({ ...w.furniture[0], id: 'arm2', aiAdded: true });
  assert.ok(!AR.validate(q2, { original: { ...p, furniture: p.furniture.filter(f => f.id !== 'arm') }, productById, allowAdd: true }).ok);
});

test('Ж11: перемещаемый предмет, отрезавший проход к неподвижному, не считается унаследованным', () => {
  H.resetIds(); const p = rect(2600, 4000); door(p, 3, 300, 800);
  const bc = atWall(p, item('bookcase', { id: 'bc', product: 'p-bookcase-rect-M', policy: 'keep' }), 1, 1300, 0);
  const sofa = freeAt(item('sofa', { id: 'sofa', product: 'p-sofa-straight-M', policy: 'free' }), 1100, 1600, 0);
  add(p, bc, sofa);
  const r = clone(p); Object.assign(r.furniture[1], { x: 1500, y: 1700 });
  assert.ok(!AR.validate(r, { original: p, productById }).ok);
});

test('солвер не ставит предмет в недоступную часть комнаты; обязательное отношение туда — невыполнимо', () => {
  H.resetIds(); const p = rect(2600, 5000); door(p, 3, 300, 800);
  add(p, freeAt(item('sofa', { id: 'sofa', product: 'p-sofa-straight-M', policy: 'keep' }), 1100, 2500, 0), freeAt(item('bookcase', { id: 'bc', policy: 'free' }), 1300, 4000, 180));
  const should = solve(p, [{ id: 'r', rel: 'against_wall', a: 'bc', wall: 'W1', prio: 'should' }]);
  assert.ok(should.solutions.length > 0);
  for (const s of should.solutions) assert.ok(s.furniture.find(f => f.id === 'bc').y > 2600, 'шкаф в доступной половине');
  const must = solve(p, [{ id: 'r', rel: 'against_wall', a: 'bc', wall: 'W1', prio: 'must' }]);
  assert.strictEqual(must.solutions.length, 0); assert.ok(must.diagnostics.some(d => d.code === 'ACCESS'));
});

test('centered_on_wall для настенного предмета: оценка — число, ТВ по центру стены', () => {
  H.resetIds(); const p = rect(4000, 5000); door(p, 4, 500, 900);
  add(p, onWall(p, item('tv', { id: 'tv', product: 'p-tv-wall-M' }), 2, 800, 1000));
  const r = solve(p, [{ id: 'r', rel: 'centered_on_wall', a: 'tv', wall: 'W2', prio: 'must' }]);
  const s = r.solutions[0]; assert.ok(Number.isFinite(s.score));
  const tv = s.furniture.find(f => f.id === 'tv'); assert.strictEqual(tv.wallId, 'w2'); assert.ok(Math.abs(tv.offset + tv.dims.W / 2 - 2500) <= 50);
});

test('предмет «Ничего не делать» на переехавшей тумбе не наследует её нарушения', () => {
  H.resetIds(); const p = rect(3500, 4000); door(p, 3, 300, 800); win(p, 1, 'center', 1600);
  const st = atWall(p, item('tv-stand', { id: 'st', product: 'p-tv-stand-rect-M', policy: 'free' }), 1, 1750, 0);
  const tv = onBase(item('tv', { id: 'tv', product: 'p-tv-stand-M', policy: 'keep' }), st); add(p, st, tv);
  const r = solve(p);
  for (const s of r.solutions) assert.ok(!s.inherited.some(v => v.rule === 'Ж5'), 'ТВ на тумбе у окна перенесён вместе с тумбой');
});

test('гости зоны: тумбы посреди боков кровати и кресло вплотную к дивану — нарушение', () => {
  H.resetIds(); const p = rect(4000, 4000); door(p, 3, 300, 800);
  const bed = atWall(p, item('bed', { id: 'bed', product: 'p-bed-double-M' }), 1, 2000, 0);
  add(p, bed, freeAt(item('nightstand', { id: 'n1', product: 'p-nightstand-rect-M' }), 2000 - 800 - 250, 1100, 0), freeAt(item('nightstand', { id: 'n2', product: 'p-nightstand-rect-M' }), 2000 + 800 + 250, 1100, 0));
  assert.ok(AR.validate(p, { productById }).violations.some(v => v.rule === 'Ж10' && v.ids.includes('bed')));
  const q = rect(4000, 4000); door(q, 3, 300, 800);
  add(q, atWall(q, item('sofa', { id: 's', product: 'p-sofa-straight-M' }), 1, 2000, 0), freeAt(item('armchair', { id: 'a', product: 'p-armchair-rect-S' }), 2000, 900 + 385 + 100, 0));
  assert.ok(AR.validate(q, { productById }).violations.some(v => v.rule === 'Ж10' && v.ids.includes('s')));
});

test('радиатор учитывается уже при поиске; настенный предмет не выходит сквозь соседнюю стену в остром углу', () => {
  H.resetIds(); const p = rect(3000, 3000); door(p, 3, 300, 800);
  add(p, onWall(p, item('radiator', { id: 'rad', policy: 'keep' }), 1, 1500, 150), freeAt(item('pouf', { id: 'pouf', policy: 'free' }), 1500, 360, 0));
  const r = solve(p); assert.ok(r.solutions.length > 0);
  const t = room([[0, 0], [4000, 0], [4000, 4000], [0, 4000 - Math.round(4000 * Math.tan(Math.PI / 6))]]); door(t, 1, 700, 800);
  const sh = item('wall-shelf', { id: 'sh', product: 'p-wall-shelf-wall-M' }); onWall(t, sh, 2, 4000 - sh.dims.W / 2, 1500); add(t, sh);
  assert.ok(AR.validate(t, { productById }).violations.some(v => v.rule === 'Ж1' && v.ids.includes('sh')));
});

test('«Оставить на месте» угловой пустышки: товары другой формы встают в тот же угол', () => {
  H.resetIds(); const p = rect(4000, 4000); door(p, 4, 300, 800);
  const R0 = R.buildRoom(p); const c = R0.corners.find(k => Math.abs(k.x - 4000) < 1 && Math.abs(k.y) < 1);
  const fp = item('fireplace', { id: 'fp', form: 'corner', policy: 'replace', formAny: true });
  const pose = AR.poseFromAnchor({ kind: 'corner', x: c.x, y: c.y, rot: 90, mirror: false }, 'fireplace', 'corner', fp.dims); Object.assign(fp, pose); add(p, fp);
  const a = AR.anchorOf(AR.describe(fp, R0), R0); assert.strictEqual(a.kind, 'corner');
  const rectPose = AR.poseFromAnchor(a, 'fireplace', 'rect', H.PRODUCT.get('p-fireplace-rect-M').dims);
  const D = AR.describe({ ...fp, formId: 'rect', dims: H.PRODUCT.get('p-fireplace-rect-M').dims, ...rectPose }, R0);
  assert.ok(require('../../public/shared/geometry.js').insideRoom(D.poly, p, R0.d), 'прямой камин в том же углу, внутри комнаты');
});

test('строгий бюджет проверяется валидатором (Ж13), а замена без стены не роняет солвер', () => {
  H.resetIds(); const p = rect(3500, 4000); door(p, 4, 400, 800);
  add(p, freeAt(item('sofa', { id: 's', policy: 'free' }), 1750, 2000, 0));
  const prep = S.prepare(p, H.PRODUCTS, { budget: { mode: 'strict', amount: 12000 } });
  const r = S.solveConcept(prep, { key: 'c', relations: [] }, { seed: 1 }); assert.strictEqual(r.solutions.length, 0);
  assert.ok(r.diagnostics.some(d => d.code === 'BUDGET'));
  const q = rect(3000, 3000); door(q, 3, 300, 800); const pic = item('picture', { id: 'pic', product: 'p-picture-wall-M', policy: 'replace' }); pic.wallId = 'nope'; pic.offset = 100; pic.elev = 1400; add(q, pic);
  assert.doesNotThrow(() => solve(q));
});
