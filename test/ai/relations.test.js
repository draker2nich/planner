/* Словарь отношений (ТЗ §18.6): оценки 0–1 и кандидатные позы от партнёра */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers.js');
const R = require('../../public/shared/ai-room.js');
const AR = require('../../public/shared/ai-rules.js');
const REL = require('../../public/shared/ai-relations.js');
const { rect, door, win, item, atWall, freeAt, add, productById } = H;

function scene(items) {
  H.resetIds(); const p = rect(4000, 5000); door(p, 4, 500, 900); win(p, 1, 'center', 1600); add(p, ...items(p));
  const room = R.buildRoom(p); const ctx = AR.mkCtx(room, p.furniture, { productById });
  const descs = AR.describeAll(room, p.furniture, ctx); return { p, room, env: REL.mkEnv(room, descs), descs };
}
const sc = (env, r) => REL.score({ prio: 'should', ...r }, env);

test('against_wall, centered_on_wall, same_wall', () => {
  const { env } = scene(p => [atWall(p, item('sofa', { id: 's', product: 'p-sofa-straight-M' }), 3, 2000, 50), atWall(p, item('armchair', { id: 'a', product: 'p-armchair-rect-M' }), 3, 3400, 0), freeAt(item('table', { id: 't', product: 'p-table-rect-M' }), 2000, 2000, 0)]);
  assert.strictEqual(sc(env, { rel: 'against_wall', a: 's', wall: 'W3' }), 1);
  assert.strictEqual(sc(env, { rel: 'against_wall', a: 's', wall: 'W1' }), 0);
  assert.strictEqual(sc(env, { rel: 'against_wall', a: 's', wall: 'with_window' }), 0);
  assert.strictEqual(sc(env, { rel: 'against_wall', a: 't' }), 0);
  assert.strictEqual(sc(env, { rel: 'centered_on_wall', a: 's', wall: 'W3' }), 1);
  assert.strictEqual(sc(env, { rel: 'same_wall', a: 'a', b: 's' }), 1);
});

test('facing, opposite, in_front_of с диапазоном', () => {
  const { env } = scene(p => [atWall(p, item('sofa', { id: 's', product: 'p-sofa-straight-M' }), 3, 2000, 50), atWall(p, item('tv-stand', { id: 'tv', product: 'p-tv-stand-rect-M' }), 1, 2000, 0), freeAt(item('coffee-table', { id: 'ct', product: 'p-coffee-table-rect-M' }), 2000, 5000 - 50 - 900 - 400 - 300, 0)]);
  assert.strictEqual(sc(env, { rel: 'facing', a: 's', b: 'tv' }), 1);
  assert.ok(sc(env, { rel: 'opposite', a: 'tv', b: 's' }) > 0.8, '3,6 м — чуть дальше диапазона по умолчанию 1,5–3,5 м');
  assert.strictEqual(sc(env, { rel: 'opposite', a: 'tv', b: 's', range: [3000, 4000] }), 1);
  assert.strictEqual(sc(env, { rel: 'in_front_of', a: 'ct', b: 's' }), 1, 'столик в 400 мм перед диваном, по центру');
  assert.ok(sc(env, { rel: 'in_front_of', a: 'ct', b: 's', range: [1000, 1500] }) < 0.1);
  assert.strictEqual(sc(env, { rel: 'in_front_of', a: 'tv', b: 'ct' }), 0, 'ТВ за столиком — не перед ним');
});

test('beside со стороной и выравниванием, symmetric', () => {
  const { env, descs } = scene(p => { const bed = atWall(p, item('bed', { id: 'bed', product: 'p-bed-double-M' }), 1, 2000, 0); return [bed]; });
  const bed = descs[0]; const sh = { typeId: 'nightstand', w: 450, h: 400 };
  const left = REL.propose({ rel: 'beside', a: 'n', b: 'bed', side: 'left', range: [0, 100] }, 'n', sh, env);
  assert.ok(left.length >= 2 && left.every(p => bed.fr.l(p).x < 0));
  const back = left.find(p => p.tag === 'beside:back');
  const { env: env2 } = scene(p => [atWall(p, item('bed', { id: 'bed', product: 'p-bed-double-M' }), 1, 2000, 0), freeAt(item('nightstand', { id: 'n1', product: 'p-nightstand-rect-M' }), back.x, back.y, back.rot)]);
  assert.strictEqual(sc(env2, { rel: 'beside', a: 'n1', b: 'bed', side: 'left', align: 'back' }), 1);
  assert.strictEqual(sc(env2, { rel: 'beside', a: 'n1', b: 'bed', side: 'right' }), 0);
  const mir = REL.propose({ rel: 'symmetric', a: 'n2', b: 'n1', c: 'bed' }, 'n2', sh, env2)[0];
  const { env: env3 } = scene(p => [atWall(p, item('bed', { id: 'bed', product: 'p-bed-double-M' }), 1, 2000, 0), freeAt(item('nightstand', { id: 'n1', product: 'p-nightstand-rect-M' }), back.x, back.y, back.rot), freeAt(item('nightstand', { id: 'n2', product: 'p-nightstand-rect-M' }), mir.x, mir.y, mir.rot)]);
  assert.strictEqual(sc(env3, { rel: 'symmetric', a: 'n2', b: 'n1', c: 'bed' }), 1);
});

test('around: места вокруг стола по 600 мм края, стулья лицом к столу', () => {
  const { env, descs } = scene(p => [freeAt(item('table', { id: 't', product: 'p-table-rect-M' }), 2000, 2500, 0)]);
  const slots = REL.seatSlots(descs[0], { w: 450, h: 500 });
  assert.strictEqual(slots.length, 2 * Math.floor(1400 / 600) + 2 * Math.floor(800 / 600));
  const chairs = slots.slice(0, 3).map((s, i) => freeAt(item('chair', { id: 'c' + i, product: 'p-chair-rect-M' }), s.x, s.y, s.rot));
  const { env: e2 } = scene(() => [freeAt(item('table', { id: 't', product: 'p-table-rect-M' }), 2000, 2500, 0), ...chairs]);
  assert.ok(sc(e2, { rel: 'around', a: ['c0', 'c1', 'c2'], b: 't' }) > 0.95);
  assert.strictEqual(REL.score({ rel: 'around', a: ['c9'], b: 't', prio: 'must' }, env), 0, 'стульев нет — не выполнено');
});

test('near/away от окна и входа, in_region, keep_clear, под окном', () => {
  const { env } = scene(p => [atWall(p, item('tv-stand', { id: 'u', product: 'p-tv-stand-rect-M' }), 1, 2000, 0), atWall(p, item('sofa', { id: 's', product: 'p-sofa-straight-M' }), 3, 2000, 0)]);
  assert.strictEqual(sc(env, { rel: 'under_window', a: 'u' }), 1);
  assert.strictEqual(sc(env, { rel: 'near_window', a: 'u' }), 1);
  assert.strictEqual(sc(env, { rel: 'away_from_window', a: 's' }), 1);
  assert.strictEqual(sc(env, { rel: 'in_region', a: 's', region: 'R1' }), 1);
  assert.strictEqual(sc(env, { rel: 'keep_clear', rect: [1000, 1500, 3000, 3000] }), 1);
  assert.ok(sc(env, { rel: 'keep_clear', rect: [0, 3800, 4000, 5000] }) < 0.8);
  assert.strictEqual(REL.score({ rel: 'nonsense', a: 's' }, env), null);
});

test('М11: взвешенное выполнение с приоритетами; отсутствующий предмет = 0', () => {
  const { env } = scene(p => [atWall(p, item('sofa', { id: 's', product: 'p-sofa-straight-M' }), 3, 2000, 50)]);
  const r = REL.scoreAll([{ id: 'a', rel: 'against_wall', a: 's', wall: 'W3', prio: 'must' }, { id: 'b', rel: 'against_wall', a: 's', wall: 'W1', prio: 'nice' }, { id: 'c', rel: 'near_window', a: 'missing', prio: 'should' }], env);
  assert.ok(Math.abs(r.s - 3 / 6) < 1e-9); assert.strictEqual(r.done, 1); assert.strictEqual(r.n, 3);
});
