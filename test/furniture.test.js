'use strict';
/* Габариты и проверка расстановки мебели (public/js/editor/furniture/geometry.js) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore, rect, doorAt, windowAt } = require('./helpers/editor-core.js');

const c = loadCore();
const sofa = (id, x, y, o = {}) => ({ id, typeId: 'sofa', formId: 'straight', name: 'Диван ' + id, dims: { W: 2200, D: 900, H: 850 }, x, y, rot: 0, mirror: false, ...o });
const rug = (id, x, y) => ({ id, typeId: 'rug', formId: 'rect', name: 'Ковёр ' + id, dims: { W: 2000, D: 1500, H: 10 }, x, y, rot: 0, mirror: false });
const room = (furniture, over = {}) => rect(5400, 3900, { mode: 'furniture', furniture, ...over });
const check = (p) => c.call('validateProject', p);
const bbox = (fp, d) => { const r = c.ev(`(() => { const l = fpPoly(${JSON.stringify(fp)}, ${JSON.stringify(d)}); return { w: l.w, h: l.h, n: l.pts.length, a: aabbOf(l.pts) }; })()`); return r; };

c.setProject(room([]));

test('габарит прямоугольника и квадрата', () => {
  assert.deepEqual([bbox('rect', { W: 2200, D: 900 }).w, bbox('rect', { W: 2200, D: 900 }).h], [2200, 900]);
  assert.deepEqual([bbox('square', { W: 600 }).w, bbox('square', { W: 600 }).h], [600, 600]);
});
test('габарит круга и овала', () => {
  const k = bbox('circle', { DIA: 500 }); assert.deepEqual([k.w, k.h, k.n], [500, 500, 32]);
  const e = bbox('ellipse', { W: 1200, D: 700 }); assert.deepEqual([e.w, e.h], [1200, 700]);
});
test('габарит Г‑образной, П‑образной и угловой (четверть круга) форм', () => {
  const L = bbox('L', { A: 2600, B: 1800, D: 900 }); assert.deepEqual([L.w, L.h, L.n], [2600, 1800, 6]);
  const U = bbox('U', { A: 3000, B: 1800, D: 900 }); assert.deepEqual([U.w, U.h, U.n], [3000, 1800, 8]);
  const Q = bbox('quarter', { R: 900 }); assert.deepEqual([Q.w, Q.h], [900, 900]);
});
test('контур формы центрирован относительно начала координат', () => {
  for (const [fp, d] of [['rect', { W: 2200, D: 900 }], ['L', { A: 2600, B: 1800, D: 900 }], ['circle', { DIA: 500 }], ['quarter', { R: 900 }]]) {
    const a = bbox(fp, d).a; assert.ok(Math.abs(a.cx) < 1e-6 && Math.abs(a.cy) < 1e-6, fp);
  }
});
test('глубина Г‑образной формы не больше её сторон', () => {
  assert.deepEqual(c.ev("fpPoly('L', { A: 1000, B: 800, D: 5000 }).pts.length"), 6);
  assert.equal(bbox('L', { A: 1000, B: 800, D: 5000 }).w, 1000);
});
test('поворот на 90° меняет ширину и глубину местами, центр остаётся', () => {
  const a = c.ev(`aabbOf(fWorld(${JSON.stringify(sofa('s', 2000, 1500, { rot: 90 }))}))`);
  assert.deepEqual([Math.round(a.w), Math.round(a.h), Math.round(a.cx), Math.round(a.cy)], [900, 2200, 2000, 1500]);
});
test('поворот на 180° и 360° сохраняет габарит', () => {
  for (const rot of [180, 360]) { const a = c.ev(`aabbOf(fWorld(${JSON.stringify(sofa('s', 2000, 1500, { rot }))}))`); assert.deepEqual([Math.round(a.w), Math.round(a.h)], [2200, 900]); }
});
test('зеркало отражает несимметричную форму', () => {
  const item = { id: 'c', typeId: 'sofa', formId: 'corner', name: 'Угловой', dims: { A: 2600, B: 1800, D: 900, H: 850 }, x: 2500, y: 1800, rot: 0, mirror: false };
  const plain = c.ev(`fWorld(${JSON.stringify(item)})`), flipped = c.ev(`fWorld(${JSON.stringify({ ...item, mirror: true })})`);
  assert.equal(plain.length, flipped.length);
  plain.forEach((p, i) => { assert.ok(Math.abs((p.x - 2500) + (flipped[i].x - 2500)) < 1e-6); assert.ok(Math.abs(p.y - flipped[i].y) < 1e-6); });
});
test('предмет внутри комнаты проходит проверку', () => assert.equal(check(room([sofa('s1', 2000, 1500)])), null));
test('предмет, выходящий за стену, отклоняется', () => {
  assert.match(check(room([sofa('s1', 300, 1500)])), /вне комнаты или в стене/);
  assert.match(check(room([sofa('s1', 2000, 3800)])), /вне комнаты или в стене/);
  assert.match(check(room([sofa('s1', 9000, 9000)])), /вне комнаты или в стене/);
});
test('предмет вплотную к стене допустим', () => assert.equal(check(room([sofa('s1', 1100, 450)])), null));
test('два напольных предмета не могут пересекаться', () => {
  assert.match(check(room([sofa('s1', 2000, 1500), sofa('s2', 2500, 1700)])), /Диван s1 пересекает Диван s2/);
  assert.equal(check(room([sofa('s1', 1500, 1000), sofa('s2', 3000, 3000)])), null);
});
test('ковёр лежит под мебелью и с ней не конфликтует', () => assert.equal(check(room([rug('r', 2000, 1500), sofa('s1', 2000, 1500)])), null));
test('в режиме стен мебель не проверяется', () => assert.equal(check(room([sofa('s1', 300, 1500)], { mode: 'walls' })), null));
test('без замкнутого контура мебель не проверяется', () => {
  const p = room([sofa('s1', 9000, 9000)]); p.walls.pop();
  assert.equal(check(p), null);
});
test('неизвестный тип предмета даёт сообщение, а не падение', () => assert.match(check(room([{ ...sofa('s1', 2000, 1500), typeId: 'nope' }])), /неизвестный тип/));
test('настенный предмет: должен помещаться на стене', () => {
  const tv = (offset) => ({ id: 't', typeId: 'tv', formId: 'wall', name: 'ТВ', dims: { W: 1250, D: 80, H: 720, E: 1000 }, wallId: 'w0', offset, x: 0, y: 0, rot: 0 });
  assert.equal(check(room([tv(1000)])), null);
  assert.match(check(room([tv(4500)])), /не помещается на стене/);
  assert.match(check(room([{ ...tv(1000), wallId: 'nope' }])), /стена не найдена/);
});
test('размеры товара из каталога менять нельзя', () => {
  const pr = c.ev('PRODUCTS[0]');
  const item = (dims) => ({ id: 'p', typeId: pr.typeId, formId: pr.formId, name: pr.name, productId: pr.id, dims, x: 2500, y: 1800, rot: 0, mirror: false });
  assert.equal(check(room([item(pr.dims)])), null);
  assert.match(check(room([item({ ...pr.dims, W: pr.dims.W + 100 })])), /размеры товара фиксированы/);
});
test('предупреждения: зона открывания двери и подход к окну', () => {
  c.setProject(room([sofa('s1', 1300, 600), sofa('s2', 2500, 3300), sofa('s3', 4000, 2000)], { openings: [doorAt('d', 'w0', 500), windowAt('a', 'w2', 2000)] }));
  assert.deepEqual(c.ev('furnitureWarnings(P.furniture[0])'), ['door']);
  assert.deepEqual(c.ev('furnitureWarnings(P.furniture[1])'), ['window']);
  assert.deepEqual(c.ev('furnitureWarnings(P.furniture[2])'), []);
  assert.equal(c.ev('doorZones().length'), 1);
});
test('дверь, открывающаяся наружу, зоны в комнате не занимает', () => {
  c.setProject(room([sofa('s1', 1300, 600)], { openings: [doorAt('d', 'w0', 500, 800, { swing: 'out' })] }));
  assert.deepEqual(c.ev('furnitureWarnings(P.furniture[0])'), []);
});
test('insideRoom в Г‑образной комнате: вырез считается «снаружи»', () => {
  const { lshape } = require('./helpers/editor-core.js');
  c.setProject(lshape({ mode: 'furniture' }));
  assert.equal(c.ev(`insideRoom(fWorld(${JSON.stringify(sofa('s', 1500, 1500))}))`), true);
  assert.equal(c.ev(`insideRoom(fWorld(${JSON.stringify(sofa('s', 4000, 4000))}))`), false);
  assert.equal(c.ev(`insideRoom(fWorld(${JSON.stringify(sofa('s', 3000, 2800))}))`), false, 'предмет пересекает стену у вогнутого угла');
});
