'use strict';
/* Геометрия: пересечения, расстояния, площадь (public/js/editor/core/geometry.js) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./helpers/editor-core.js');

const c = loadCore();
const P = (x, y) => ({ x, y });
const seg = (a, b, p, q) => c.call('segInter', a, b, p, q);

test('orient: поворот налево, направо, на одной прямой', () => {
  assert.equal(c.call('orient', P(0, 0), P(10, 0), P(5, 5)), 1);
  assert.equal(c.call('orient', P(0, 0), P(10, 0), P(5, -5)), -1);
  assert.equal(c.call('orient', P(0, 0), P(10, 0), P(20, 0)), 0);
});
test('segInter: крест пересекается', () => assert.equal(seg(P(0, 0), P(10, 10), P(0, 10), P(10, 0)), true));
test('segInter: далёкие отрезки не пересекаются', () => assert.equal(seg(P(0, 0), P(10, 0), P(0, 5), P(10, 5)), false));
test('segInter: касание концом (буква Т) считается пересечением', () => assert.equal(seg(P(0, 0), P(10, 0), P(5, 0), P(5, 10)), true));
test('segInter: общий конец считается пересечением', () => assert.equal(seg(P(0, 0), P(10, 0), P(10, 0), P(10, 10)), true));
test('segInter: коллинеарные с наложением пересекаются, без наложения — нет', () => {
  assert.equal(seg(P(0, 0), P(10, 0), P(5, 0), P(15, 0)), true);
  assert.equal(seg(P(0, 0), P(10, 0), P(11, 0), P(20, 0)), false);
});
test('segInter: продолжения пересекаются, сами отрезки — нет', () => assert.equal(seg(P(0, 0), P(4, 4), P(10, 0), P(6, 4.5)), false));
test('segInter симметричен относительно порядка отрезков и концов', () => {
  const cases = [[P(0, 0), P(10, 10), P(0, 10), P(10, 0)], [P(0, 0), P(10, 0), P(0, 5), P(10, 5)], [P(0, 0), P(10, 0), P(5, 0), P(5, 10)]];
  for (const [a, b, p, q] of cases) { const r = seg(a, b, p, q); assert.equal(seg(p, q, a, b), r); assert.equal(seg(b, a, q, p), r); }
});
test('distPtSeg: до середины, за концом, вырожденный отрезок', () => {
  assert.equal(c.call('distPtSeg', P(5, 5), P(0, 0), P(10, 0)), 5);
  assert.equal(c.call('distPtSeg', P(13, 4), P(0, 0), P(10, 0)), 5);
  assert.equal(c.call('distPtSeg', P(3, 4), P(0, 0), P(0, 0)), 5);
  assert.equal(c.call('distPtSeg', P(5, 0), P(0, 0), P(10, 0)), 0);
});
test('shoelace: площадь со знаком зависит от направления обхода', () => {
  const sq = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];
  assert.equal(c.call('shoelace', sq), 100);
  assert.equal(c.call('shoelace', sq.slice().reverse()), -100);
  assert.equal(c.call('shoelace', [P(0, 0), P(4, 0), P(0, 3)]), 6);
});
test('lineInter: точка пересечения прямых; параллельные → null', () => {
  assert.deepEqual(c.call('lineInter', P(0, 0), P(1, 0), P(5, -5), P(0, 1)), { x: 5, y: 0 });
  assert.equal(c.call('lineInter', P(0, 0), P(1, 0), P(0, 5), P(2, 0)), null);
});
test('rectsOverlap: наложение, касание, зазор с отступом', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  assert.equal(c.call('rectsOverlap', a, { x: 5, y: 5, w: 10, h: 10 }), true);
  assert.equal(c.call('rectsOverlap', a, { x: 10, y: 0, w: 10, h: 10 }), false, 'касание стороной — не наложение');
  assert.equal(c.call('rectsOverlap', a, { x: 12, y: 0, w: 10, h: 10 }), false);
  assert.equal(c.call('rectsOverlap', a, { x: 12, y: 0, w: 10, h: 10 }, 5), true, 'с отступом 5 зазор в 2 считается наложением');
});
test('rectSegInter: отрезок внутри, насквозь, мимо', () => {
  const r = { x: 0, y: 0, w: 10, h: 10 };
  assert.equal(c.call('rectSegInter', r, P(2, 2), P(4, 4)), true);
  assert.equal(c.call('rectSegInter', r, P(-5, 5), P(15, 5)), true);
  assert.equal(c.call('rectSegInter', r, P(-5, -5), P(15, -5)), false);
});
test('sub, dot, hyp', () => {
  assert.deepEqual(c.call('sub', P(5, 7), P(2, 3)), { x: 3, y: 4 });
  assert.equal(c.call('dot', P(1, 2), P(3, 4)), 11);
  assert.equal(c.call('hyp', P(3, 4)), 5);
});
