'use strict';
/* Геометрия ИИ‑дизайнера в редакторе: способы постановки → координаты, проверка, доводка, права, сборка варианта. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEditor, room, item } = require('./editor-helpers.js');

const E = loadEditor();
/* объекты из контекста редактора принадлежат другому «миру» Node: сравниваются по содержимому */
const same = (a, b, msg) => assert.deepStrictEqual(a === undefined ? a : JSON.parse(JSON.stringify(a)), b, msg);
const near = (a, b, eps = 1.5) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const blank = (id, mode, extra) => Object.assign({ id, mode, wall: '', offset: 0, gap: 0, ref: '', side: 'none', shift: 0, face: 'auto', x: 0, y: 0, elev: -1 }, extra);
/* контекст с уже стоящими предметами: placed — готовы, byAlias — обозначения i1… */
function setup(P, placed = []) {
  const ctx = E.call('aiCtx', P);
  placed.forEach((f, k) => { ctx.byAlias.set('i' + (k + 1), f); ctx.ready.add(f.id); });
  return ctx;
}
const fits = (f, placed, ctx) => E.call('aiFits', f, placed, ctx);
const put = (f, sp, ctx) => { const fr = E.call('aiResolve', sp, f, ctx); assert.ok(!fr.err, 'способ постановки разобран: ' + fr.err); E.call('aiApplyFrame', f, fr, ctx.d); return fr; };

test('стены обходятся по контуру, начало стены — её опорный конец, центр комнаты внутри', () => {
  const ctx = setup(room());
  same(ctx.walls.map(i => ctx.wallAlias.get(i.w.id) + ':' + i.w.id), ['W1:top', 'W2:right', 'W3:bottom', 'W4:left']);
  same(ctx.centre, { x: 2500, y: 2000 });
  const data = E.call('aiRoomData', ctx);
  same(data.walls[2].openings, [{ kind: 'door', from: 300, to: 1200, swing: 'in' }]);
  same(data.walls[0].openings, [{ kind: 'window', from: 1500, to: 3000, sill: 900, top: 2300 }]);
  /* комната буквой Г: центр масс может лежать у самого угла — берётся просторная точка внутри */
  const L = room(); L.vertices = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 6000, y: 0 }, { id: 'c', x: 6000, y: 1500 }, { id: 'd', x: 1500, y: 1500 }, { id: 'e', x: 1500, y: 6000 }, { id: 'f', x: 0, y: 6000 }];
  L.walls = ['ab', 'bc', 'cd', 'de', 'ef', 'fa'].map(s => ({ id: s, a: s[0], b: s[1] })); L.openings = [];
  const c = E.call('aiCtx', L).centre;
  assert.ok(E.call('pointInPoly', c, L.vertices) && c.x < 1500 + 1 || c.y < 1500 + 1, 'центр внутри комнаты');
});

test('«у стены»: спиной к стене, лицом в комнату, отступ от начала стены', () => {
  const P = room(), ctx = setup(P), sofa = item(E, 'sofa');
  put(sofa, blank('x', 'wall', { wall: 'W4', offset: 500 }), ctx);            // левая стена, начало в (0,0)
  near(sofa.x, 450); near(sofa.y, 500 + 1100); assert.equal(sofa.rot, 270);   // лицо смотрит вправо
  assert.equal(fits(sofa, [], ctx), null);
  same(E.call('aiDescribe', sofa, ctx), { mode: 'wall', wall: 'W4', offset: 500 });
  put(sofa, blank('x', 'wall', { wall: 'W1', offset: 99999 }), ctx);          // отступ больше стены — прижимается к её концу
  near(sofa.x, 5000 - 1100); near(sofa.y, 450); assert.equal(sofa.rot, 0);
  assert.equal(E.call('aiResolve', blank('x', 'wall', { wall: 'W9' }), sofa, ctx).err, 'no_room');
  const long = item(E, 'sofa', { dims: { W: 5600 } });
  assert.equal(E.call('aiResolve', blank('x', 'wall', { wall: 'W1' }), long, ctx).err, 'no_room', 'предмет длиннее стены');
});

test('«рядом»: стол перед диваном, тумбы по бокам кровати на одной линии, стул лицом к столу', () => {
  const P = room(6000, 5000, { door: false, window: false });
  const sofa = item(E, 'sofa'), ctx = setup(P, [sofa]);
  put(sofa, blank('x', 'wall', { wall: 'W4', offset: 1000 }), ctx);            // у левой стены, лицом вправо: центр (450, 2100)
  const table = item(E, 'coffee-table');
  put(table, blank('x', 'beside', { ref: 'i1', side: 'front', gap: 400 }), ctx);
  near(table.x, 900 + 400 + 300); near(table.y, 2100);                         // глубина стола 600 вдоль взгляда дивана
  assert.equal(fits(table, [sofa], ctx), null);

  const bed = item(E, 'bed', { formId: 'double' }), ctx2 = setup(P, [bed]);
  put(bed, blank('x', 'wall', { wall: 'W1', offset: 2000 }), ctx2);            // изголовьем к верхней стене
  const n1 = item(E, 'nightstand'), n2 = item(E, 'nightstand');
  put(n1, blank('x', 'beside', { ref: 'i1', side: 'left', gap: 50 }), ctx2);
  put(n2, blank('x', 'beside', { ref: 'i1', side: 'right', gap: 50 }), ctx2);
  near(n1.y, 200); near(n2.y, 200);                                           // тыл тумб на линии изголовья
  assert.equal(n1.rot, bed.rot); near(Math.abs(n1.x - bed.x), 800 + 50 + 225); assert.ok((n1.x - bed.x) * (n2.x - bed.x) < 0, 'по разные стороны');
  assert.equal(fits(n1, [bed], ctx2), null); assert.equal(fits(n2, [bed, n1], ctx2), null);

  const desk = item(E, 'table'), ctx3 = setup(P, [desk]); desk.x = 3000; desk.y = 2500;
  for (const side of ['front', 'back', 'left', 'right']) {
    const ch = item(E, 'chair'); put(ch, blank('x', 'beside', { ref: 'i1', side, gap: 50 }), ctx3);
    const ay = E.call('aiAxes', ch.rot).ay, to = { x: desk.x - ch.x, y: desk.y - ch.y };
    assert.ok(ay.x * to.x + ay.y * to.y > 0, `стул со стороны ${side} смотрит на стол`);
    assert.equal(fits(ch, [desk], ctx3), null);
  }
  same(E.call('aiResolve', blank('x', 'beside', { ref: 'i7' }), item(E, 'chair'), ctx3), { err: 'bad_ref' });
});

test('«повесить»: телевизор напротив дивана, картина над диваном, высота по умолчанию', () => {
  const P = room(), sofa = item(E, 'sofa'), ctx = setup(P, [sofa]);
  put(sofa, blank('x', 'wall', { wall: 'W4', offset: 1000 }), ctx);            // центр дивана y=2100, смотрит вправо
  const tv = item(E, 'tv');
  put(tv, blank('x', 'mount', { ref: 'i1', side: 'front' }), ctx);
  assert.equal(tv.wallId, 'right'); near(tv.offset + tv.dims.W / 2, 2100); assert.equal(tv.elev, 1000);
  const pic = item(E, 'picture');
  put(pic, blank('x', 'mount', { ref: 'i1', side: 'back' }), ctx);
  assert.equal(pic.wallId, 'left'); near(pic.offset + pic.dims.W / 2, 2100); assert.equal(pic.elev, 1300, 'обычная высота выше спинки дивана');
  const shelf = item(E, 'wall-shelf'), tall = item(E, 'dresser', { dims: { H: 1500 } }), ctx2 = setup(P, [tall]);
  put(tall, blank('x', 'wall', { wall: 'W2', offset: 500 }), ctx2);
  put(shelf, blank('x', 'mount', { ref: 'i1', side: 'back' }), ctx2);
  assert.equal(shelf.elev, 1650, 'над высоким предметом — выше него на 150');
  put(shelf, blank('x', 'mount', { wall: 'W2', offset: 100, elev: 99999 }), ctx2);
  assert.equal(shelf.elev, 2700 - 30, 'высота ограничена потолком');
});

test('проверки ИИ: дверь, проход, окно выше подоконника, проём на стене, настенное внутри мебели', () => {
  const P = room(), ctx = setup(P);
  const ward = item(E, 'wardrobe');
  put(ward, blank('x', 'wall', { wall: 'W3', offset: 0 }), ctx);                // нижняя стена: дверь от 300 до 1200
  assert.equal(fits(ward, [], ctx), 'door');
  const arch = room(); arch.openings = [{ id: 'a1', kind: 'arch', name: 'Арка 1', wallId: 'bottom', offset: 2000, width: 900, height: 2100, radius: 0 }];
  const c2 = setup(arch), pouf = item(E, 'pouf'); pouf.x = 2450; pouf.y = 4000 - 500;
  assert.equal(fits(pouf, [], c2), 'passage', 'перед аркой 800 мм свободны');
  pouf.y = 4000 - 1100; assert.equal(fits(pouf, [], c2), null);
  put(ward, blank('x', 'wall', { wall: 'W1', offset: 1600 }), ctx);
  assert.equal(fits(ward, [], ctx), 'window', 'шкаф перед окном');
  const low = item(E, 'tv-stand');                                             // высота 500 < подоконника 900
  put(low, blank('x', 'wall', { wall: 'W1', offset: 1600 }), ctx);
  assert.equal(fits(low, [], ctx), null, 'низкая тумба под окном допустима');
  same(E.call('furnitureWarnings', low, Object.assign({}, P, { furniture: [low] }), ctx.d), [], 'и в обычном редакторе про окно не предупреждает');
  same(E.call('furnitureWarnings', ward, Object.assign({}, P, { furniture: [ward] }), ctx.d), ['window']);
  const tv = item(E, 'tv');
  put(tv, blank('x', 'mount', { wall: 'W3', offset: 200 }), ctx);
  assert.equal(fits(tv, [], ctx), 'opening', 'телевизор поверх двери');
  const rad = item(E, 'radiator');
  put(rad, blank('x', 'mount', { wall: 'W1', offset: 1800 }), ctx);
  assert.equal(fits(rad, [], ctx), null, 'радиатор под окном');
  const cur = item(E, 'curtain');
  put(cur, blank('x', 'mount', { wall: 'W1', offset: 1300 }), ctx);
  assert.equal(fits(cur, [], ctx), null, 'штора на окне');
  put(ward, blank('x', 'wall', { wall: 'W2', offset: 500 }), ctx);
  put(tv, blank('x', 'mount', { wall: 'W2', offset: 700 }), ctx);
  assert.equal(fits(tv, [ward], ctx), 'collision', 'телевизор «за шкафом»');
  const stand = item(E, 'tv-stand');
  put(stand, blank('x', 'wall', { wall: 'W4', offset: 500 }), ctx); put(tv, blank('x', 'mount', { wall: 'W4', offset: 700 }), ctx);
  assert.equal(fits(tv, [stand], ctx), null, 'телевизор над тумбой');
  const out = item(E, 'sofa'); out.x = -200; out.y = 2000;
  assert.equal(fits(out, [], ctx), 'outside');
});

test('расстановка: пересечения разводятся сдвигом, ссылки разрешаются по порядку, место «как было» сохраняется', () => {
  const P = room(), ctx = setup(P);
  const sofa = item(E, 'sofa', { id: 'sofa', x: 2500, y: 2000 }), chair = item(E, 'armchair', { id: 'arm', x: 800, y: 3000 }), tbl = item(E, 'coffee-table', { id: 'ct', x: 4000, y: 3000 });
  const ward = item(E, 'wardrobe', { id: 'ward' }); E.call('aiApplyFrame', ward, E.call('aiResolve', blank('x', 'wall', { wall: 'W2', offset: 0 }), ward, ctx), ctx.d);
  const start = [ward, sofa, chair, tbl];
  const info = new Map(start.map(f => [f.id, { f0: f, kind: E.call('aiKind', f), movable: f.id !== 'ward', changed: false }]));
  const at = new Map(start.map(f => [f.id, E.call('aiDescribe', f, ctx)]));
  const items = JSON.parse(JSON.stringify(start));
  ['i1', 'i2', 'i3', 'i4'].forEach((a, k) => ctx.byAlias.set(a, items[k]));
  const specs = new Map([
    ['ct', blank('i4', 'beside', { ref: 'i2', side: 'front', gap: 400 })],     // стол ссылается на диван, который ставится в этом же ответе
    ['sofa', blank('i2', 'wall', { wall: 'W2', offset: 600 })],                // налезает на шкаф (0…1800) — должен сдвинуться вдоль стены
    ['arm', Object.assign(blank('i3', 'free', {}), at.get('arm'))],            // «оставить на месте»
  ]);
  const res = E.call('aiPlace', { items, info, specs, at }, ctx, {});
  same(res.failed, []); assert.equal(res.placed.length, 4);
  const [w2, s2, a2, t2] = items;
  near(s2.x, 5000 - 450); assert.ok(s2.y - 1100 >= 1800 - 2, 'диван сдвинут за шкаф: ' + s2.y);
  near(t2.y, s2.y); near(t2.x, 5000 - 900 - 400 - 300);
  same([a2.x, a2.y, a2.rot], [800, 3000, 0]);
  same([w2.x, w2.y], [ward.x, ward.y], 'неподвижный предмет не тронут');
});

test('расстановка: что не встало по ответу модели — ставит программа; кольцо ссылок не мешает', () => {
  const P = room(), ctx = setup(P);
  const a = item(E, 'wardrobe', { id: 'a', x: 2500, y: 2000 }), b = item(E, 'wardrobe', { id: 'b', x: 2500, y: 3000 }), c = item(E, 'plant', { id: 'c', x: 600, y: 600 }), d = item(E, 'plant', { id: 'd', x: 4400, y: 600 });
  const start = [a, b, c, d];
  const info = new Map(start.map(f => [f.id, { f0: f, kind: 'floor', movable: true, changed: false }]));
  const at = new Map(start.map(f => [f.id, E.call('aiDescribe', f, ctx)]));
  const specs = new Map([['a', blank('i1', 'wall', { wall: 'W3', offset: 100 })],   // вся зона у двери: сдвиг вдоль стены найдёт место
    ['b', blank('i2', 'free', { x: -5000, y: -5000 })],                              // вне комнаты
    ['c', blank('i3', 'beside', { ref: 'i4', side: 'left' })], ['d', blank('i4', 'beside', { ref: 'i3', side: 'left' })]]); // кольцо
  const mk = () => { const items = JSON.parse(JSON.stringify(start)); ['i1', 'i2', 'i3', 'i4'].forEach((al, k) => ctx.byAlias.set(al, items[k])); return { items, info, specs, at }; };
  const r1 = E.call('aiPlace', mk(), ctx, {});
  same(r1.failed.map(x => x.id), ['b']); assert.equal(r1.failed[0].code, 'outside');
  same(r1.waiting.sort(), ['c', 'd'], 'кольцо ссылок ждёт');
  const V = mk(), r2 = E.call('aiPlace', V, ctx, { fallback: true });
  same(r2.failed, []); assert.equal(r2.placed.length, 4); assert.ok(r2.auto.includes('b'));
  for (const f of V.items) assert.equal(E.call('aiFits', f, V.items.filter(x => x !== f), ctx), null, f.id + ' стоит без нарушений');
});

test('замена без перемещения: предмет у стены остаётся у стены; предел размеров — по соседям', () => {
  const P = room(6000, 4000, { door: false, window: false }), ctx = setup(P);
  const a = item(E, 'dresser', { id: 'a' }), b = item(E, 'wardrobe', { id: 'b' }), c = item(E, 'bookcase', { id: 'c' });
  put(a, blank('x', 'wall', { wall: 'W1', offset: 2000 }), ctx);               // комод 1000 между шкафами: слева до 1800, справа с 3400
  put(b, blank('x', 'wall', { wall: 'W1', offset: 0 }), ctx); put(c, blank('x', 'wall', { wall: 'W1', offset: 3400 }), ctx);
  const mf = E.call('aiMaxFit', a, [a, b, c], ctx);
  assert.ok(mf.w >= 1380 && mf.w <= 1600, 'ширина ограничена соседями: ' + mf.w);   // 200 слева + 1000 + 400 справа; оценка осторожная — по трём основным привязкам
  assert.ok(mf.d >= 3900, 'в глубину свободно до противоположной стены: ' + mf.d);
  const wide = Object.assign({}, a, { dims: Object.assign({}, a.dims, { W: 1500 }) });
  const fr = E.call('aiFirstFit', wide, E.call('aiAnchors', a, wide, ctx), [b, c], ctx);
  assert.ok(fr, 'нашлась привязка'); near(wide.y, 225); assert.ok(wide.x - 750 >= 1800 - 2 && wide.x + 750 <= 3400 + 2, 'между соседями');
  const tv = item(E, 'tv', { id: 'tv', wallId: 'bottom', offset: 1000 }), big = Object.assign({}, tv, { dims: Object.assign({}, tv.dims, { W: 1650 }) });
  same(E.call('aiAnchors', tv, big, ctx).map(f => f.offset).slice(0, 5), [800, 1000, 600, 850, 750], 'по центру, по краям, затем промежуточные');
});

test('права: что возможно с пустышкой, предметом на основании и угловым предметом', () => {
  const lamp = item(E, 'table-lamp', { productId: 'p1' }), ph = item(E, 'sofa'), prod = item(E, 'sofa', { productId: 'p2' }), corner = item(E, 'fireplace', { formId: 'corner', productId: 'p3' }), lsofa = item(E, 'sofa', { formId: 'corner', productId: 'p4' });
  const pol = (f, p) => E.call('aiPolicy', f, p);
  same(['keep', 'move', 'replace', 'free'].map(p => pol(prod, p)), ['keep', 'move', 'replace', 'free']);
  same(['keep', 'move', 'replace', 'free'].map(p => pol(ph, p)), ['replace', 'free', 'replace', 'free'], 'пустышка всегда получает товар');
  same(['keep', 'move', 'replace', 'free'].map(p => pol(lamp, p)), ['keep', 'keep', 'replace', 'replace'], 'лампа едет вместе с тумбой');
  same(['move', 'free'].map(p => pol(corner, p)), ['keep', 'replace']);
  same(['move', 'free'].map(p => pol(lsofa, p)), ['move', 'free'], 'угловой диван двигать можно');
  const o = E.call('aiPolicyOptions', ph); assert.ok(o.keep && o.move && !o.replace && !o.free);
  const ol = E.call('aiPolicyOptions', lamp); assert.ok(!ol.keep && ol.move && !ol.replace && ol.free);
});

/* ---------- сборка варианта ---------- */
const prod = (id, typeId, formId, dims, name) => ({ id, typeId, formId, name: name || id, price: 100, currency: 'BYN', dims });
function job(P, start, policies, picks, layout, extra = {}) {
  const ctx = E.call('aiCtx', P);
  return Object.assign({ index: 0, mode: 'new', ctx, start, policy: new Map(Object.entries(policies)), groups: [], concept: { title: 'Т', note: '', layoutIdea: '', picks, finishes: { walls: '#eeeeee', floor: 'texture:wood-oak', ceiling: 'keep' } },
    baseFinishes: { walls: { top: null, right: null, bottom: null, left: null }, floor: { type: 'color', color: '#d9cfbf' }, ceiling: null }, pass: 'p', layout }, extra);
}

test('вариант: товары подставлены, права соблюдены, лампа уехала за тумбой, отделка применена', async () => {
  E.call('setProducts', [prod('S1', 'sofa', 'straight', { W: 2000, D: 900, H: 800 }, 'Диван Норд'), prod('N1', 'nightstand', 'rect', { W: 500, D: 400, H: 550 }, 'Тумба Лес'), prod('L0', 'table-lamp', 'round', { DIA: 250, H: 450 }, 'Лампа'), prod('K0', 'bookcase', 'rect', { W: 1200, D: 350, H: 2000 }, 'Шкаф книжный')], 'server');
  const P = room(), c0 = E.call('aiCtx', P);
  const keep = item(E, 'bookcase', { id: 'keep', productId: 'K0' }); E.call('aiApplyFrame', keep, E.call('aiResolve', blank('x', 'wall', { wall: 'W2', offset: 200 }), keep, c0), c0.d);
  const sofa = item(E, 'sofa', { id: 'sofa', x: 2500, y: 2500 });                                  // пустышка, «двигать и заменять»
  const ns = item(E, 'nightstand', { id: 'ns', x: 1500, y: 1500 });                                // пустышка, «заменить» (место сохраняется)
  const lamp = item(E, 'table-lamp', { id: 'lamp', productId: 'L0', baseId: 'ns', x: 1550, y: 1480 });
  const calls = [];
  const layout = async (req) => { calls.push(req); return { placements: [blank('i2', 'wall', { wall: 'W4', offset: 800 })] }; };
  const cell = await E.call('aiBuildVariant', job(P, [keep, sofa, ns, lamp], { keep: 'keep', sofa: 'free', ns: 'replace', lamp: 'keep' }, { sofa: ['S1'], ns: ['N1'] }, layout));
  assert.equal(cell.failed, undefined, cell.failed);
  const by = Object.fromEntries(cell.furniture.map(f => [f.id, f]));
  same([by.sofa.productId, by.sofa.name, by.sofa.dims.W], ['S1', 'Диван Норд', 2000]);
  near(by.sofa.x, 450); near(by.sofa.y, 800 + 1000);
  assert.equal(by.ns.productId, 'N1'); same([by.ns.x, by.ns.y], [1500, 1500], '«Заменить»: тумба осталась на месте');
  same([by.lamp.x, by.lamp.y], [1550, 1480], 'лампа на прежнем месте столешницы');
  same([by.keep.x, by.keep.y, by.keep.productId], [keep.x, keep.y, 'K0']);
  same(cell.finishes.walls.top, { type: 'color', color: '#eeeeee' });
  assert.equal(cell.finishes.floor.textureId, 'wood-oak'); assert.equal(cell.finishes.ceiling, null);
  /* запрос к модели: неподвижные — fixed с габаритом, подвижные — с нынешним местом; предмет на основании не передаётся */
  assert.equal(calls.length, 1);
  const items = Object.fromEntries(calls[0].items.map(i => [i.id, i]));
  same(Object.keys(items), ['i1', 'i2', 'i3']);
  assert.equal(items.i1.fixed, true); assert.equal(items.i1.box.length, 4); assert.equal(items.i3.fixed, true);
  assert.equal(items.i2.fixed, undefined); same([items.i2.w, items.i2.d], [2000, 900], 'размеры уже выбранного товара');
  same(items.i2.at, { mode: 'free', x: 2500, y: 2500, face: 'down' });
});

test('вариант: первый товар не помещается — берётся следующий; повторный запрос к модели один', async () => {
  E.call('setProducts', [prod('BIG', 'wardrobe', 'rect', { W: 4800, D: 600, H: 2200 }), prod('MID', 'wardrobe', 'rect', { W: 1600, D: 600, H: 2200 }), prod('T1', 'table', 'rect', { W: 1400, D: 800, H: 750 })], 'server');
  const P = room(3000, 3000, { window: false });
  const w = item(E, 'wardrobe', { id: 'w', x: 1500, y: 1500 }), t = item(E, 'table', { id: 't', productId: 'T1', x: 1500, y: 600 });
  const calls = [];
  const layout = async (req) => { calls.push(req); return { placements: [blank('i1', 'wall', { wall: 'W1', offset: 0 })] }; };
  const cell = await E.call('aiBuildVariant', job(P, [w, t], { w: 'free', t: 'keep' }, { w: ['BIG', 'MID'] }, layout));
  assert.equal(cell.failed, undefined, cell.failed);
  const got = cell.furniture.find(f => f.id === 'w');
  assert.equal(got.productId, 'MID', 'шкаф 4800 в комнату 3000 не входит — взят следующий');
  assert.equal(calls.length, 2); assert.equal(calls[1].retry, true);
  assert.equal(calls[1].items.find(i => i.id === 'i1').problem, 'no_room');
  assert.equal(cell.stats.spare, 1);
});

test('вариант: товары группы меняются вместе; несменившийся из‑за тесноты предмет получает замечание', async () => {
  E.call('setProducts', [prod('C1', 'chair', 'rect', { W: 3200, D: 500, H: 900 }), prod('C2', 'chair', 'rect', { W: 450, D: 500, H: 900 }), prod('D1', 'dresser', 'rect', { W: 2400, D: 450, H: 900 })], 'server');
  const P = room(3000, 3000, { window: false, door: false }), c0 = E.call('aiCtx', P);
  const a = item(E, 'chair', { id: 'a', x: 1000, y: 1500 }), b = item(E, 'chair', { id: 'b', x: 2000, y: 1500 });
  const dr = item(E, 'dresser', { id: 'dr' }), bc = item(E, 'bookcase', { id: 'bc' });
  E.call('aiApplyFrame', dr, E.call('aiResolve', blank('x', 'wall', { wall: 'W1', offset: 0 }), dr, c0), c0.d);      // комод 1000 у стены, вплотную шкаф 1200
  E.call('aiApplyFrame', bc, E.call('aiResolve', blank('x', 'wall', { wall: 'W1', offset: 1000 }), bc, c0), c0.d);
  const layout = async () => ({ placements: [] });                                                                 // модель промолчала — предметы остаются где стояли
  const cell = await E.call('aiBuildVariant', job(P, [a, b, dr, bc], { a: 'free', b: 'free', dr: 'replace', bc: 'keep' }, { a: ['C1', 'C2'], b: ['C1', 'C2'], dr: ['D1'] }, layout, { groups: [['a', 'b']] }));
  assert.equal(cell.failed, undefined, cell.failed);
  const by = Object.fromEntries(cell.furniture.map(f => [f.id, f]));
  same([by.a.productId, by.b.productId], ['C2', 'C2'], 'оба стула получили один и тот же запасной товар');
  assert.equal(by.dr.productId, null, 'комод 2400 не встаёт рядом со шкафом — замена отменена');
  same([by.dr.x, by.dr.y], [dr.x, dr.y]);
  assert.equal(cell.warnings.length, 1); assert.match(cell.warnings[0].text, /осталась пустышка/);
});

test('вариант: если предмет некуда поставить — вариант не строится и называет причину', async () => {
  E.call('setProducts', [], 'server');
  const P = room(2000, 2000, { window: false, door: false });
  const a = item(E, 'wardrobe', { id: 'a', x: 1000, y: 500, dims: { W: 1900 } }), b = item(E, 'wardrobe', { id: 'b', x: 1000, y: 1500, dims: { W: 1900, D: 1900 } });
  const cell = await E.call('aiBuildVariant', job(P, [a, b], { a: 'keep', b: 'move' }, {}, async () => ({ placements: [blank('i2', 'center', { ref: 'room' })] })));
  assert.match(cell.failed, /Не удалось расставить: Шкаф/);
  assert.equal(cell.furniture, undefined);
});

test('проверка перед запуском и места для подбора', () => {
  E.call('setProducts', [prod('S1', 'sofa', 'straight', { W: 2000, D: 900, H: 800 }), prod('S2', 'sofa', 'straight', { W: 2300, D: 950, H: 850 })], 'server');
  const P = room(), c0 = E.call('aiCtx', P);
  const sofa = item(E, 'sofa', { id: 'sofa', productId: 'S1', dims: { W: 2000, D: 900, H: 800 } }); E.call('aiApplyFrame', sofa, E.call('aiResolve', blank('x', 'wall', { wall: 'W4', offset: 500 }), sofa, c0), c0.d);
  const bed = item(E, 'bed', { id: 'bed', x: 3500, y: 2000 });
  E.sandbox.P = null; E.ev('P=' + JSON.stringify(Object.assign({}, P, { furniture: [sofa, bed] })) + ';D=derive(P);');
  const pre = E.call('aiPrecheck', new Map([['sofa', 'replace'], ['bed', 'free']]), { walls: 'keep' });
  same(pre.errors, []);
  same(pre.slots.map(s => s.id), ['sofa']); same(pre.empty.map(f => f.id), ['bed'], 'кроватей в каталоге нет');
  assert.equal(pre.slots[0].policy, 'replace'); assert.ok(pre.slots[0].maxFit.w >= 2900 && pre.slots[0].maxFit.w <= 3300, 'расти можно до зоны двери: ' + pre.slots[0].maxFit.w);
  same([pre.room.area, pre.room.doors, pre.room.windows, pre.room.longestWall], [20, 1, 1, 5000]);
  assert.equal(E.call('aiNeeds', new Map([['sofa', 'keep'], ['bed', 'keep']]), { walls: 'keep', floor: 'keep', ceiling: 'keep', lighting: 'ai' }), true, 'пустышка требует товара');
  E.ev('P.furniture=[P.furniture[0]];');
  assert.equal(E.call('aiNeeds', new Map([['sofa', 'keep']]), { walls: 'keep', floor: 'keep', ceiling: 'keep', lighting: 'ai' }), false, '«освещение и декор» — не работа для дизайнера');
  assert.equal(E.call('aiNeeds', new Map([['sofa', 'keep']]), { walls: 'ai' }), true);
  /* предмет вне комнаты или пересечение — генерация не запускается */
  E.ev('P.furniture[0].x=-900;');
  assert.match(E.call('aiPrecheck', new Map([['sofa', 'free']]), {}).errors[0], /Сначала исправьте расстановку/);
  E.ev('P.furniture[0].x=450;P.furniture[0].productId="GONE";');
  assert.match(E.call('aiPrecheck', new Map([['sofa', 'free']]), {}).errors[0], /товара больше нет в каталоге/);
});

/* ---------- найденное при проверке ---------- */
test('быстрая проверка aiFits согласована с validateFurniture на случайных расстановках', () => {
  const P = room(6000, 5000, { door: false, window: false }), ctx = setup(P);
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const types = ['sofa', 'armchair', 'coffee-table', 'wardrobe', 'rug', 'plant', 'chandelier', 'bed', 'tv', 'picture', 'table'];
  let agree = 0, bad = 0, coll = 0;
  for (let n = 0; n < 60; n++) {
    const items = [];
    for (let k = 0; k < 14; k++) {
      const tp = types[Math.floor(rnd() * types.length)], f = item(E, tp, tp === 'sofa' && rnd() < 0.3 ? { formId: 'corner' } : {});
      if (E.call('aiMount', f) === 'wall') { f.wallId = ['top', 'right', 'bottom', 'left'][Math.floor(rnd() * 4)]; f.offset = Math.round(rnd() * 4600 - 300); }
      else { f.x = Math.round(rnd() * 6400 - 200); f.y = Math.round(rnd() * 5400 - 200); f.rot = [0, 90, 180, 270, 37][Math.floor(rnd() * 5)]; f.mirror = rnd() < 0.2; }
      items.push(f);
    }
    for (const f of items) {
      const others = items.filter(x => x !== f);
      const Q = Object.assign({}, P, { furniture: items, _strict: [f.id] });
      const want = E.call('validateFurniture', Q, ctx.d);
      const got = E.call('aiFits', f, others, ctx, ['door', 'passage', 'window', 'opening', 'collision', 'height']);
      /* настенное «внутри» напольного — правило только для ИИ: здесь сверяются общие правила */
      if (!!want === !!got) agree++; else { bad++; if (bad < 4) console.log('расхождение', f.typeId, want, got); }
      if (want) coll++;
    }
  }
  assert.equal(bad, 0, `совпало ${agree}, разошлось ${bad}`);
  assert.ok(coll > 100, 'в выборке хватает и запретных положений: ' + coll);
});

test('узкий длинный предмет встаёт вплотную к любой из четырёх стен', () => {
  const P = room(5000, 4000, { door: false, window: false }), ctx = setup(P);
  for (const dims of [{ W: 2400, D: 605 }, { W: 1800, D: 451 }, { W: 3001, D: 333 }]) for (const wall of ['W1', 'W2', 'W3', 'W4']) for (const offset of [0, 137, 500]) {
    const f = item(E, 'wardrobe', { dims }); put(f, blank('x', 'wall', { wall, offset }), ctx);
    assert.equal(fits(f, [], ctx), null, `${dims.W}×${dims.D} у ${wall}, отступ ${offset}`);
  }
});

test('замена предмета, стоявшего в углу, оставляет его в углу', () => {
  const P = room(5000, 4000, { door: false, window: false }), ctx = setup(P);
  const sofa = item(E, 'sofa', { formId: 'corner' }); put(sofa, blank('x', 'wall', { wall: 'W1', offset: 0 }), ctx);       // угловой диван в левом верхнем углу
  const small = Object.assign({}, sofa, { dims: Object.assign({}, sofa.dims, { A: 2200 }) });
  const fr = E.call('aiFirstFit', small, E.call('aiAnchors', sofa, small, ctx), [], ctx);
  assert.ok(fr); near(small.x - 1100, 0); assert.equal(fr._off, 0, 'левый край по‑прежнему у боковой стены');
  const tv = item(E, 'tv', { wallId: 'right', offset: 4000 - 1250 }), tv2 = Object.assign({}, tv, { dims: Object.assign({}, tv.dims, { W: 900 }) });
  assert.equal(E.call('aiAnchors', tv, tv2, ctx)[0].offset, 4000 - 900, 'прижатое к концу стены остаётся у конца');
  const mid = item(E, 'tv', { wallId: 'right', offset: 1000 });
  assert.equal(E.call('aiAnchors', mid, Object.assign({}, mid, { dims: Object.assign({}, mid.dims, { W: 850 }) }), ctx)[0].offset, 1200, 'посреди стены — по центру прежнего места');
});

test('вариант: стол‑пустышка с лампой получает товар, когда его разрешено двигать', async () => {
  E.call('setProducts', [prod('D1', 'desk', 'rect', { W: 1600, D: 700, H: 750 }, 'Стол Дуб'), prod('L0', 'table-lamp', 'round', { DIA: 250, H: 450 }, 'Лампа')], 'server');
  const P = room(5000, 4000, { door: false, window: false }), c0 = E.call('aiCtx', P);
  const a = item(E, 'bookcase', { id: 'a' }), b = item(E, 'bookcase', { id: 'b' }), desk = item(E, 'desk', { id: 'desk' });
  E.call('aiApplyFrame', a, E.call('aiResolve', blank('x', 'wall', { wall: 'W1', offset: 0 }), a, c0), c0.d);
  E.call('aiApplyFrame', desk, E.call('aiResolve', blank('x', 'wall', { wall: 'W1', offset: 1200 }), desk, c0), c0.d);     // стол 1200 зажат между шкафами: товар 1600 сюда не встанет
  E.call('aiApplyFrame', b, E.call('aiResolve', blank('x', 'wall', { wall: 'W1', offset: 2400 }), b, c0), c0.d);
  const lamp = item(E, 'table-lamp', { id: 'lamp', productId: 'L0', baseId: 'desk', x: desk.x + 300, y: desk.y });
  const cell = await E.call('aiBuildVariant', job(P, [a, b, desk, lamp], { a: 'keep', b: 'keep', desk: 'free', lamp: 'keep' }, { desk: ['D1'] }, async () => ({ placements: [blank('i3', 'wall', { wall: 'W3', offset: 1000 })] })));
  assert.equal(cell.failed, undefined, cell.failed);
  const by = Object.fromEntries(cell.furniture.map(f => [f.id, f]));
  assert.equal(by.desk.productId, 'D1', 'товар не отброшен из‑за лампы'); near(by.desk.y, 4000 - 350);
  near(by.lamp.x - by.desk.x, -300, 2); near(by.lamp.y, by.desk.y, 2);   // стол развёрнут на 180°: лампа на том же месте столешницы
  same(cell.warnings, []);
});

test('предмет, который некуда переставить, остаётся там, где его поставил заказчик', async () => {
  E.call('setProducts', [], 'server');
  const P = room(2400, 2500, { window: false });                                    // дверь на нижней стене: кровать неизбежно в её зоне
  const bed = item(E, 'bed', { id: 'bed', formId: 'king', x: 1300, y: 1150 });
  const c0 = E.call('aiCtx', P);
  assert.ok(E.call('aiIssues', bed, [], c0).length, 'у заказчика кровать стоит с замечанием ИИ');
  const cell = await E.call('aiBuildVariant', job(P, [bed], { bed: 'move' }, {}, async () => ({ placements: [blank('i1', 'wall', { wall: 'W3', offset: 0 })] })));
  assert.equal(cell.failed, undefined, cell.failed);
  same([cell.furniture[0].x, cell.furniture[0].y, cell.furniture[0].rot], [1300, 1150, 0]);
});

test('расстановка 60 предметов при бестолковом ответе модели укладывается в секунды', async () => {
  E.call('setProducts', [], 'server');
  const P = room(12000, 9000, { door: true, window: true });
  const start = [], pol = {}, placements = [];
  for (let k = 0; k < 60; k++) { const f = item(E, ['armchair', 'coffee-table', 'plant', 'pouf', 'chair', 'nightstand'][k % 6], { id: 'm' + k, x: 800 + (k % 10) * 1100, y: 800 + Math.floor(k / 10) * 1300 }); start.push(f); pol[f.id] = 'move'; placements.push(blank('i' + (k + 1), 'center', { ref: 'room' })); }
  const t0 = Date.now();
  const cell = await E.call('aiBuildVariant', job(P, start, pol, {}, async () => ({ placements })));
  const ms = Date.now() - t0;
  assert.equal(cell.failed, undefined, cell.failed);
  assert.ok(ms < 8000, 'время расчёта: ' + ms + ' мс');
});

test('проверка перед запуском на 60 предметах с правом «Заменить» не подвешивает мастер', () => {
  const list = []; for (let k = 0; k < 400; k++) list.push(prod('P' + k, 'nightstand', 'rect', { W: 400 + (k % 9) * 20, D: 380 + (k % 5) * 10, H: 500 }));
  E.call('setProducts', list, 'server');
  const P = room(12000, 9000), items = [], pol = new Map();
  for (let k = 0; k < 60; k++) { const f = item(E, 'nightstand', { id: 'n' + k, productId: 'P0', dims: { W: 400, D: 380, H: 500 }, x: 600 + (k % 10) * 1100, y: 1500 + Math.floor(k / 10) * 1200 }); items.push(f); pol.set(f.id, 'replace'); }
  E.ev('P=' + JSON.stringify(Object.assign({}, P, { furniture: items })) + ';D=derive(P);');
  const t0 = Date.now(); const pre = E.call('aiPrecheck', pol, {}); const ms = Date.now() - t0;
  same(pre.errors, []); assert.equal(pre.slots.length, 60);
  assert.ok(ms < 2500, 'время проверки: ' + ms + ' мс');
});

test('случайные планы и случайные ответы модели: права соблюдаются, построенный вариант проходит проверку редактора', async () => {
  let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648, pickOf = (a) => a[Math.floor(rnd() * a.length)];
  const cat = [];
  for (const [t, form, base] of [['sofa', 'straight', { W: 2000, D: 900, H: 850 }], ['armchair', 'rect', { W: 850, D: 850, H: 850 }], ['nightstand', 'rect', { W: 450, D: 400, H: 500 }], ['wardrobe', 'rect', { W: 1600, D: 600, H: 2200 }], ['table-lamp', 'round', { DIA: 250, H: 450 }], ['tv', 'wall', { W: 1200, D: 80, H: 700, E: 1000 }], ['rug', 'rect', { W: 2000, D: 1400, H: 10 }], ['coffee-table', 'rect', { W: 1000, D: 600, H: 450 }]])
    for (let k = 0; k < 4; k++) { const d = Object.assign({}, base); for (const key of Object.keys(d)) if (key !== 'E' && key !== 'H') d[key] = Math.round(d[key] * (0.8 + k * 0.15)); cat.push(prod(`${t}-${k}`, t, form, d, `${t} ${k}`)); }
  E.call('setProducts', cat, 'server');
  const modes = ['wall', 'mount', 'beside', 'center', 'free'], pols = ['keep', 'move', 'replace', 'free'];
  let built = 0, failed = 0;
  for (let n = 0; n < 40; n++) {
    const P = room(4500 + Math.floor(rnd() * 3) * 1000, 3800 + Math.floor(rnd() * 2) * 1200), ctx = E.call('aiCtx', P);
    /* исходная расстановка: предметы добавляются, только если встают без нарушений общих правил */
    const start = [], policies = {};
    const tryAdd = (f) => { const Q = Object.assign({}, P, { furniture: [...start, f], _strict: [f.id] }); if (E.call('validateFurniture', Q, ctx.d)) return false; start.push(f); policies[f.id] = pickOf(pols); return true; };
    for (let k = 0; k < 9; k++) {
      const t = pickOf(['sofa', 'armchair', 'nightstand', 'wardrobe', 'tv', 'rug', 'coffee-table']), withProduct = rnd() < 0.5, pr = cat.find(p => p.typeId === t);
      const f = item(E, t, Object.assign({ id: 'f' + n + '_' + k }, withProduct ? { productId: pr.id, dims: pr.dims, name: pr.name } : {}));
      if (t === 'tv') { f.wallId = pickOf(['top', 'right', 'bottom', 'left']); f.offset = Math.round(rnd() * 2000); E.call('aiApplyFrame', f, { wallId: f.wallId, offset: f.offset, elev: f.elev }, ctx.d); }
      else if (rnd() < 0.5) E.call('aiApplyFrame', f, E.call('aiResolve', blank('x', 'wall', { wall: pickOf(['W1', 'W2', 'W3', 'W4']), offset: Math.round(rnd() * 3000) }), f, ctx), ctx.d);
      else { f.x = 600 + Math.round(rnd() * 3200); f.y = 600 + Math.round(rnd() * 2600); f.rot = pickOf([0, 90, 180, 270]); }
      if (tryAdd(f) && t === 'nightstand' && rnd() < 0.7) { const l = item(E, 'table-lamp', { id: f.id + 'L', productId: 'table-lamp-0', dims: cat.find(p => p.id === 'table-lamp-0').dims, baseId: f.id, x: f.x + 60, y: f.y - 40, rot: f.rot }); tryAdd(l); }
    }
    if (!start.length) continue;
    const policy = {}; for (const f of start) policy[f.id] = E.call('aiPolicy', f, policies[f.id]);
    const picks = {}; for (const f of start) if (['replace', 'free'].includes(policy[f.id])) picks[f.id] = cat.filter(p => p.typeId === f.typeId && p.id !== f.productId).sort(() => rnd() - 0.5).slice(0, 3).map(p => p.id);
    const garbage = async (req) => ({ placements: req.items.filter(i => !i.fixed && rnd() < 0.9).map(i => blank(i.id, pickOf(modes), { wall: pickOf(['W1', 'W2', 'W3', 'W4', '']), offset: Math.round(rnd() * 6000 - 500), gap: Math.round(rnd() * 300), ref: pickOf(['room', '', 'i1', 'i2', 'i3', 'i9', i.id]), side: pickOf(['left', 'right', 'front', 'back', 'none']), shift: Math.round(rnd() * 800 - 400), face: pickOf(['auto', 'toward', 'same', 'away', 'up', 'down', 'left', 'right']), x: Math.round(rnd() * 7000 - 500), y: Math.round(rnd() * 6000 - 500) })) });
    const cell = await E.call('aiBuildVariant', job(P, start, policy, picks, garbage));
    if (cell.failed) { failed++; continue; }
    built++;
    const by = new Map(cell.furniture.map(f => [f.id, f]));
    assert.equal(cell.furniture.length, start.length, 'предметы не добавляются и не пропадают');
    for (const f0 of start) {
      const f = by.get(f0.id), pol = policy[f0.id], where = `план ${n}, ${f0.typeId}, право ${pol}`;
      if (pol === 'keep' || pol === 'move') assert.equal(f.productId, f0.productId, 'товар не меняется: ' + where);
      if (pol === 'keep' && E.call('aiKind', f0) !== 'ontop') same(E.call('aiFrameOfItem', f), JSON.parse(JSON.stringify(E.call('aiFrameOfItem', f0))), 'предмет не сдвинут: ' + where);
      if (pol === 'replace' && E.call('aiKind', f0) === 'wall') assert.equal(f.wallId, f0.wallId, 'настенный остался на своей стене: ' + where);
      if (pol === 'replace' && E.call('aiKind', f0) === 'floor') { const b0 = E.call('aiBackWall', f0, ctx.d, ctx.Q), b1 = E.call('aiBackWall', f, ctx.d, ctx.Q); if (b0) assert.equal(b1 && b1.wallId, b0.wallId, 'остался у своей стены: ' + where); else assert.ok(Math.hypot(f.x - f0.x, f.y - f0.y) <= Math.abs(E.call('aiExt', f0).w - E.call('aiExt', f).w) / 2 + 2, 'остался на своём месте: ' + where); }
      if (!f0.productId && (picks[f0.id] || []).length && !cell.warnings.some(w => w.id === f0.id)) assert.ok(f.productId, 'пустышка получила товар: ' + where);
      if (f0.baseId) { const b = by.get(f0.baseId), bb = E.call('aabbOf', E.call('fWorldOf', b, ctx.Q, ctx.d)), aa = E.call('aabbOf', E.call('fWorld', f)); assert.ok(aa.x0 >= bb.x0 - 1.5 && aa.x1 <= bb.x1 + 1.5 && aa.y0 >= bb.y0 - 1.5 && aa.y1 <= bb.y1 + 1.5, 'лампа осталась на тумбе: ' + where); }
    }
    const Q = Object.assign({}, P, { furniture: cell.furniture, _strict: cell.furniture.map(f => f.id) });
    assert.equal(E.call('validateFurniture', Q, ctx.d), null, 'план ' + n + ' проходит строгую проверку редактора');
  }
  assert.ok(built >= 30, `построено ${built}, не построено ${failed}`);
});
