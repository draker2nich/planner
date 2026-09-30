/* Правила эргономики (ТЗ §15): жёсткие Ж1–Ж14, унаследованные нарушения, точка привязки, мягкие правила */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers.js');
const R = require('../../public/shared/ai-room.js');
const AR = require('../../public/shared/ai-rules.js');
const { rect, door, win, item, atWall, onWall, freeAt, onBase, add, clone, productById } = H;

const rules = (p, opts = {}) => AR.validate(p, { productById, ...opts }).violations;
const has = (vs, rule, id) => vs.some(v => v.rule === rule && (!id || v.ids.includes(id)));
function room4x5() { H.resetIds(); const p = rect(4000, 5000); door(p, 4, 500, 900); win(p, 1, 'center', 1600); return p; }

test('Ж1: предмет в стене и вне комнаты', () => {
  const p = room4x5(); add(p, freeAt(item('armchair', { id: 'a', product: 'p-armchair-rect-M' }), 200, 2500, 0));
  assert.ok(has(rules(p), 'Ж1', 'a'));
  p.furniture[0].x = 2000; assert.ok(!has(rules(p), 'Ж1', 'a'));
});

test('Ж2: пересечение в 3D, ТВ над тумбой и ковёр под диваном — не конфликт', () => {
  const p = room4x5();
  const tvs = atWall(p, item('tv-stand', { id: 'tvs', product: 'p-tv-stand-rect-M' }), 2, 2500, 0);
  const tv = onWall(p, item('tv', { id: 'tv', product: 'p-tv-wall-M' }), 2, 2500, 1000);
  const sofa = atWall(p, item('sofa', { id: 'sofa', product: 'p-sofa-straight-M' }), 3, 2000, 50);
  const rug = freeAt(item('rug', { id: 'rug', product: 'p-rug-rect-M' }), 2000, 4200, 0);
  add(p, tvs, tv, sofa, rug);
  const vs = rules(p); assert.ok(!has(vs, 'Ж2'), JSON.stringify(vs));
  const sh = onWall(p, item('wall-shelf', { id: 'sh', product: 'p-wall-shelf-wall-M' }), 2, 2500, 1200); add(p, sh);
  assert.ok(has(rules(p), 'Ж2', 'sh'), 'полка на высоте телевизора пересекает его');
});

test('Ж3 и Ж4: открывание двери и вход', () => {
  const p = room4x5(); const a = freeAt(item('armchair', { id: 'a', product: 'p-armchair-rect-S' }), 500, 4000, 90); add(p, a);
  const vs = rules(p); assert.ok(has(vs, 'Ж3', 'a') && has(vs, 'Ж4', 'a'));
  a.x = 2000; a.y = 2500; const v2 = rules(p); assert.ok(!has(v2, 'Ж3') && !has(v2, 'Ж4'));
});

test('Ж5: у окна — только низкое и разрешённое; французское окно', () => {
  const p = room4x5();
  const w = atWall(p, item('wardrobe', { id: 'w', product: 'p-wardrobe-rect-S' }), 1, 2000, 0); add(p, w);
  assert.ok(has(rules(p), 'Ж5', 'w'));
  p.furniture = [atWall(p, item('tv-stand', { id: 't', product: 'p-tv-stand-rect-M' }), 1, 2000, 0)];
  assert.ok(!has(rules(p), 'Ж5'), 'тумба ниже подоконника может стоять под окном');
  p.furniture = [atWall(p, item('shelving', { id: 's', product: 'p-shelving-rect-S' }), 1, 2000, 0)];
  assert.ok(has(rules(p), 'Ж5', 's'), 'стеллажу под окном нельзя (underWindow: false)');
  const q = room4x5(); q.openings[1].sill = 0; q.openings[1].height = 2200; add(q, atWall(q, item('tv-stand', { id: 't', product: 'p-tv-stand-rect-M' }), 1, 2000, 0));
  assert.ok(has(rules(q), 'Ж5', 't'), 'перед французским окном ничего нет');
});

test('Ж6: радиатор — 100 мм, высокие шкафы — 300 мм', () => {
  const p = room4x5(); const rad = onWall(p, item('radiator', { id: 'rad', policy: 'keep' }), 2, 2500, 150);
  const d = atWall(p, item('dresser', { id: 'd', product: 'p-dresser-rect-M' }), 2, 2500, 150);
  add(p, rad, d); assert.ok(has(rules(p), 'Ж6', 'd'), 'зазор 150 − глубина 100 = 50 мм до лицевой стороны');
  atWall(p, d, 2, 2500, 220); assert.ok(!has(rules(p), 'Ж6'));
  p.furniture = [rad, atWall(p, item('wardrobe', { id: 'w', product: 'p-wardrobe-rect-S' }), 2, 2500, 250)];
  assert.ok(has(rules(p), 'Ж6', 'w'), 'высокий шкаф ближе 300 мм');
  atWall(p, p.furniture[1], 2, 2500, 420); assert.ok(!has(rules(p), 'Ж6'));
});

test('Ж7: высота потолка и двухъярусная кровать', () => {
  const p = rect(4000, 5000, { height: 2100 }); door(p, 4, 500, 900);
  add(p, atWall(p, item('wardrobe', { id: 'w', product: 'p-wardrobe-rect-M' }), 2, 2500, 0));
  assert.ok(has(rules(p), 'Ж7', 'w'));
  p.furniture = [atWall(p, item('kids-bed', { id: 'b', product: 'p-kids-bed-bunk-M' }), 2, 2500, 0)];
  assert.ok(has(rules(p), 'Ж7', 'b'), 'над верхним ярусом меньше 600');
});

test('Ж8: настенные не на проёмах; над дверью можно', () => {
  const p = room4x5(); add(p, onWall(p, item('picture', { id: 'pic', product: 'p-picture-wall-M' }), 1, 'center', 1300));
  assert.ok(has(rules(p), 'Ж8', 'pic'));
  const q = room4x5(); const o = q.openings[0]; const sh = item('wall-shelf', { id: 'sh', product: 'p-wall-shelf-wall-S' });
  sh.wallId = o.wallId; sh.offset = o.offset + 50; sh.elev = o.height + 60; add(q, sh);
  assert.ok(!has(rules(q), 'Ж8'), 'полка выше двери на 60 мм');
  sh.elev = o.height + 20; assert.ok(has(rules(q), 'Ж8', 'sh'));
});

test('Ж9: основание из списка и в его габарите', () => {
  const p = room4x5(); const ns = freeAt(item('nightstand', { id: 'ns', product: 'p-nightstand-rect-M' }), 2000, 2500, 0);
  const lamp = onBase(item('table-lamp', { id: 'l', product: 'p-table-lamp-round-M' }), ns); add(p, ns, lamp);
  assert.ok(!has(rules(p), 'Ж9'));
  lamp.x += 300; assert.ok(has(rules(p), 'Ж9', 'l'), 'лампа свисает с тумбы');
  const bed = atWall(p, item('bed', { id: 'bed', product: 'p-bed-double-M' }), 3, 2000, 0); add(p, bed); onBase(lamp, bed);
  assert.ok(has(rules(p), 'Ж9', 'l'), 'кровать — не основание');
});

test('Ж10: зона перед шкафом и подход к кровати', () => {
  const p = room4x5(); const w = atWall(p, item('wardrobe', { id: 'w', product: 'p-wardrobe-rect-M' }), 2, 2500, 0);
  const s = freeAt(item('sofa', { id: 's', product: 'p-sofa-straight-M' }), 4000 - 600 - 300 - 450, 2500, 90);
  add(p, w, s); assert.ok(has(rules(p), 'Ж10', 'w'), 'диван в 300 мм от шкафа');
  s.x = 1000; assert.ok(!has(rules(p), 'Ж10', 'w'));
  // двуспальная кровать боком к стене: одной стороны достаточно (oneOf), обе закрыты — нарушение
  const q = rect(3000, 4000); door(q, 3, 200, 800);
  const bed = item('bed', { id: 'bed', product: 'p-bed-double-M' }); atWall(q, bed, 1, 1600 / 2 + 5, 0); add(q, bed);
  assert.ok(!has(rules(q), 'Ж10', 'bed'), JSON.stringify(rules(q)));
  add(q, freeAt(item('dresser', { id: 'dr', product: 'p-dresser-rect-M' }), 1605 + 225 + 10, 1300, 270));
  assert.ok(has(rules(q), 'Ж10', 'bed'));
});

test('Ж11: проход ко второй двери', () => {
  H.resetIds(); const p = rect(3000, 5000); door(p, 3, 1100, 800); door(p, 1, 1100, 800, { swing: 'out' });
  add(p, freeAt(item('bookcase', { id: 'b1', product: 'p-bookcase-rect-L' }), 720, 2500, 0), freeAt(item('bookcase', { id: 'b2', product: 'p-bookcase-rect-L' }), 2280, 2500, 180));
  assert.ok(has(rules(p), 'Ж11'), 'два шкафа перегородили комнату');
  p.furniture[1].x = 2600; p.furniture[1].rot = 270; assert.ok(!has(rules(p), 'Ж11'), JSON.stringify(rules(p)));
});

test('Ж12: товар соответствует пустышке', () => {
  const o = item('wardrobe', { id: 'w', constraints: { W: { mode: 'range', min: 1700, max: 2000 } } });
  assert.ok(AR.productCheck({ ...o, productId: 'p-wardrobe-rect-M', dims: H.PRODUCT.get('p-wardrobe-rect-M').dims }, o, H.PRODUCT.get('p-wardrobe-rect-M')) === null);
  assert.ok(AR.productCheck({ ...o, productId: 'p-wardrobe-rect-S', dims: H.PRODUCT.get('p-wardrobe-rect-S').dims }, o, H.PRODUCT.get('p-wardrobe-rect-S')));
  assert.ok(AR.productCheck({ ...o, productId: 'p-wardrobe-corner-M' }, o, H.PRODUCT.get('p-wardrobe-corner-M')), 'другая форма');
  const any = { ...item('sofa', { id: 's', formAny: true }), constraints: { W: { mode: 'range', max: 2300 } } };
  assert.ok(AR.productCheck({ ...any, productId: 'p-sofa-corner-S', formId: 'corner', dims: H.PRODUCT.get('p-sofa-corner-S').dims }, any, H.PRODUCT.get('p-sofa-corner-S')) === null, 'formAny: W — ширина габарита 2210');
  assert.ok(AR.productCheck({ ...any, productId: 'p-sofa-corner-M', formId: 'corner', dims: H.PRODUCT.get('p-sofa-corner-M').dims }, any, H.PRODUCT.get('p-sofa-corner-M')));
});

test('Ж14: инварианты прав', () => {
  const p = room4x5();
  const keep = atWall(p, item('sofa', { id: 'k', product: 'p-sofa-straight-M', policy: 'keep' }), 3, 2000, 50);
  const mv = freeAt(item('armchair', { id: 'm', product: 'p-armchair-rect-M', policy: 'move' }), 1500, 2000, 0);
  const rp = atWall(p, item('wardrobe', { id: 'r', product: 'p-wardrobe-rect-M', policy: 'replace' }), 2, 2500, 0);
  add(p, keep, mv, rp);
  const room = R.buildRoom(p); const inv = (q, o = {}) => AR.invariants(q, p, { room, ...o });
  assert.deepStrictEqual(inv(p), []);
  let q = clone(p); q.furniture[0].x += 5; assert.ok(inv(q).length, 'keep сдвинут');
  q = clone(p); q.furniture[1].productId = 'p-armchair-rect-S'; assert.ok(inv(q).length, 'move: товар изменён');
  q = clone(p); q.furniture[1].x += 700; assert.deepStrictEqual(inv(q), [], 'move может перемещаться');
  q = clone(p); const S = H.PRODUCT.get('p-wardrobe-rect-L'); const f = q.furniture[2]; f.productId = S.id; f.dims = { ...S.dims };
  Object.assign(f, AR.poseFromAnchor(AR.anchorOf(AR.describe(p.furniture[2], room), room), f.typeId, f.formId, f.dims));
  assert.deepStrictEqual(inv(q), [], 'replace от точки привязки');
  f.x -= 30; assert.ok(inv(q).length, 'replace сдвинут');
  q = clone(p); q.furniture.pop(); assert.ok(inv(q).length, 'предмет удалён');
  q = clone(p); q.vertices[1].x += 10; assert.ok(inv(q).length, 'стены изменены');
  q = clone(p); q.furniture.push({ ...item('armchair', { id: 'x', product: 'p-armchair-rect-S' }), x: 2000, y: 2000, aiAdded: true });
  assert.ok(inv(q).length, 'добавление без разрешения'); assert.deepStrictEqual(inv(q, { allowAdd: true }), []);
});

test('Унаследованное нарушение неподвижного предмета не блокирует, у перемещаемого — блокирует', () => {
  const p = room4x5(); const s = freeAt(item('armchair', { id: 's', product: 'p-armchair-rect-S', policy: 'keep' }), 600, 4000, 90); add(p, s);
  const r1 = AR.validate(p, { original: p, productById });
  assert.ok(r1.ok && r1.violations.some(v => v.inherited && v.rule === 'Ж3'));
  const q = clone(p); q.furniture[0].aiPolicy = 'move';
  const r2 = AR.validate(q, { original: q, productById }); assert.ok(!r2.ok);
});

test('Точка привязки: у стены, в углу у стены, угловая форма, свободно, на стене', () => {
  H.resetIds(); const p = rect(4000, 5000); door(p, 4, 500, 900);
  const wall = atWall(p, item('wardrobe', { product: 'p-wardrobe-rect-M' }), 2, 2500, 10);
  const corner = atWall(p, item('wardrobe', { product: 'p-wardrobe-rect-M' }), 3, 4000 - 900, 0);
  const L = item('sofa', { product: 'p-sofa-corner-M' });
  const free = freeAt(item('table', { product: 'p-table-rect-M' }), 2000, 2500, 0);
  const tv = onWall(p, item('tv', { product: 'p-tv-wall-M' }), 1, 2000, 1000);
  add(p, wall, corner, free, tv);
  const room = R.buildRoom(p); const ctx = AR.mkCtx(room, p.furniture, { productById });
  const a = (f) => AR.anchorOf(AR.describe(f, room, ctx), room);
  assert.strictEqual(a(wall).kind, 'wall'); assert.strictEqual(a(corner).kind, 'wallCorner'); assert.strictEqual(a(free).kind, 'free'); assert.strictEqual(a(tv).kind, 'wallMount');
  // угловой диван в углу: поза от вершины угла совпадает с исходной
  const c2 = room.corners.find(c => Math.abs(c.x - 4000) < 1 && Math.abs(c.y) < 1);
  const pose = AR.poseFromAnchor({ kind: 'corner', x: c2.x, y: c2.y, rot: 90, mirror: true }, 'sofa', 'corner', L.dims);
  Object.assign(L, pose); add(p, L);
  const aL = a(L); assert.strictEqual(aL.kind, 'corner'); assert.ok(Math.hypot(aL.x - 4000, aL.y) < 1);
  // больший товар от точки «у стены» растёт в комнату, задняя грань на месте
  const big = { ...H.PRODUCT.get('p-wardrobe-rect-L').dims };
  const pw = AR.poseFromAnchor(a(wall), 'wardrobe', 'rect', big);
  const dw = AR.describe({ ...wall, ...pw, dims: big }, room, ctx);
  assert.ok(Math.abs(dw.bb.x1 - (4000 - 10)) < 1, 'задняя грань на линии стены + зазор');
  const pt = AR.poseFromAnchor(a(tv), 'tv', 'wall', { ...tv.dims, W: 1500, H: 900 });
  assert.ok(Math.abs(pt.offset + 750 - (tv.offset + tv.dims.W / 2)) < 1 && Math.abs(pt.elev + 450 - (1000 + tv.dims.H / 2)) < 1, 'ТВ: центр по стене и по высоте');
});

test('Мягкие правила: оценка 0–100, неприменимые исключаются, ТВ и проходы', () => {
  const p = room4x5();
  const sofa = atWall(p, item('sofa', { id: 'sofa', product: 'p-sofa-straight-M' }), 3, 2000, 50);
  const tvs = atWall(p, item('tv-stand', { id: 'tvs', product: 'p-tv-stand-rect-M' }), 1, 2000, 0);
  const tv = onWall(p, item('tv', { id: 'tv', product: 'p-tv-wall-M' }), 2, 2500, 900);
  add(p, sofa, tvs);
  const e1 = AR.evaluate(p, { productById, purpose: ['living'] });
  assert.ok(e1.score >= 0 && e1.score <= 100); assert.strictEqual(e1.soft.M3, null); assert.strictEqual(e1.soft.M4, null);
  add(p, tv); const e2 = AR.evaluate(p, { productById, purpose: ['living'] });
  assert.ok(e2.soft.M3 && e2.soft.M3.s < 0.5, 'ТВ сбоку от дивана смотрится плохо');
  const t2 = { ...p, furniture: [sofa, tvs, onWall(p, { ...tv }, 1, 2000, 900)] };
  // на стене окна ТВ нельзя (Ж8), но для мягкой оценки важен угол: прямо напротив дивана
  const e3 = AR.evaluate(t2, { productById, purpose: ['living'] });
  assert.ok(e3.soft.M3.s > e2.soft.M3.s);
  assert.ok(e3.soft.M1.s > 0.5, 'проход свободен');
});
