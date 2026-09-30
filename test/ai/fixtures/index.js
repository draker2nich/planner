/* Эталонный набор комнат (ТЗ §28.1) с ручными замыслами для проверки солвера без языковой модели (И1).
   Фикстура = снимок проекта + задание + замыслы + ожидания. Каталог — фиксированный catalog.json.
   Стены прямоугольника rect(w, h): W1 — верхняя (y = 0), W2 — правая, W3 — нижняя, W4 — левая. */
'use strict';
const H = require('../helpers.js');
const { rect, room, regular, door, win, arch, item, atWall, onWall, freeAt, onBase, add } = H;

const rel = (id, r, a, b, extra = {}) => ({ id, rel: r, a, ...(b ? { b } : {}), prio: 'should', ...extra });
const must = (id, r, a, b, extra = {}) => rel(id, r, a, b, { ...extra, prio: 'must' });
const nice = (id, r, a, b, extra = {}) => rel(id, r, a, b, { ...extra, prio: 'nice' });
const ph = (typeId, id, opts = {}) => item(typeId, { id, policy: 'free', ...opts });           // пустышка «можно перемещать»
const radiatorUnder = (p, wallNo, t, id) => onWall(p, item('radiator', { id, policy: 'keep' }), wallNo, t, 150);

const F = [];
function fx(id, title, build) {
  H.resetIds(); const f = build();
  // настенные пустышки без места — на первую стену, как если бы пользователь их повесил
  for (const it of f.project.furniture) if (!it.wallId && H.G.itemMount(it) === 'wall') onWall(f.project, it, 1, 'center');
  F.push({ id, title, task: { allowAdd: false, people: 2, purpose: ['living'], budget: { mode: 'none' }, ...(f.task || {}) }, expect: { feasible: true, minSolutions: 1, ...(f.expect || {}) }, project: f.project, concepts: f.concepts }); }

/* ---------- Формы ---------- */
fx('living-3x4', 'Гостиная 3×4: диван напротив ТВ', () => {
  const p = rect(3000, 4000); door(p, 4, 300, 800); win(p, 1, 'center', 1400); radiatorUnder(p, 1, 1500, 'rad1');
  add(p, ph('sofa', 'sofa', { product: 'p-sofa-straight-S' }), ph('coffee-table', 'ct'), ph('tv-stand', 'tvs'), ph('tv', 'tv'));
  return { project: p, concepts: [
    { key: 'c1', name: 'Диван у стены напротив окна', relations: [must('r1', 'against_wall', 'sofa', null, { wall: 'W3' }), rel('r2', 'opposite', 'tvs', 'sofa'), rel('r3', 'in_front_of', 'ct', 'sofa')] },
    { key: 'c2', name: 'Диван у длинной стены', relations: [rel('r1', 'against_wall', 'sofa', null, { wall: 'W2' }), rel('r2', 'against_wall', 'tvs', null, { wall: 'W4' })] },
  ] };
});
fx('living-4x5', 'Гостиная 4×5: диван «Ничего не делать», две пустышки, строгий бюджет', () => {
  const p = rect(4000, 5000); door(p, 4, 500, 900); win(p, 1, 'center', 1600); radiatorUnder(p, 1, 2000, 'rad1');
  const sofa = atWall(p, item('sofa', { id: 'sofa', product: 'p-sofa-straight-M', policy: 'keep' }), 3, 2000, 50);
  add(p, sofa, ph('armchair', 'arm'), ph('coffee-table', 'ct'), ph('tv-stand', 'tvs'));
  return { task: { budget: { mode: 'strict', amount: 80000, currency: 'RUB' } }, project: p, concepts: [
    { key: 'c1', name: 'ТВ напротив дивана', relations: [rel('r1', 'opposite', 'tvs', 'sofa'), rel('r2', 'in_front_of', 'ct', 'sofa'), rel('r3', 'beside', 'arm', 'sofa')] },
    { key: 'c2', name: 'Кресло у окна', relations: [rel('r1', 'near_window', 'arm'), rel('r2', 'in_front_of', 'ct', 'sofa')] },
  ] };
});
fx('bedroom-3x3.6', 'Спальня 3×3,6: кровать, тумбы, шкаф', () => {
  const p = rect(3000, 3600); door(p, 3, 300, 800); win(p, 1, 'center', 1200); radiatorUnder(p, 1, 1500, 'rad1');
  add(p, ph('bed', 'bed', { form: 'double' }), ph('nightstand', 'ns1'), ph('nightstand', 'ns2'), ph('wardrobe', 'ward'));
  return { task: { purpose: ['bedroom'] }, project: p, concepts: [
    { key: 'c1', name: 'Изголовьем к глухой стене', relations: [must('r1', 'against_wall', 'bed', null, { wall: 'W2' }), rel('r2', 'against_wall', 'ward', null, { wall: 'W4' })] },
    { key: 'c2', name: 'Шкаф у входа', relations: [rel('r1', 'against_wall', 'bed', null, { wall: 'W4' }), rel('r2', 'near_entrance', 'ward')] },
  ] };
});
fx('kids-3.5x3.5', 'Детская 3,5×3,5: кровать, стол, шкаф, стеллаж', () => {
  const p = rect(3500, 3500); door(p, 3, 2400, 800, { hinge: 'right' }); win(p, 1, 'center', 1400);
  add(p, ph('kids-bed', 'bed'), ph('desk', 'desk'), ph('chair', 'chair'), ph('wardrobe', 'ward'), ph('shelving', 'shelf'));
  return { task: { purpose: ['kids'], people: 1 }, project: p, concepts: [
    { key: 'c1', name: 'Стол у окна', relations: [rel('r1', 'near_window', 'desk'), rel('r2', 'in_corner', 'bed'), rel('r3', 'in_front_of', 'chair', 'desk')] },
    { key: 'c2', name: 'Кровать у окна', relations: [rel('r1', 'near_window', 'bed'), rel('r2', 'against_wall', 'desk', null, { wall: 'W2' })] },
  ] };
});
fx('office-narrow-2.6x6', 'Узкий кабинет 2,6×6', () => {
  const p = rect(2600, 6000); door(p, 3, 900, 800); win(p, 1, 'center', 1200);
  add(p, ph('desk', 'desk'), ph('office-chair', 'och'), ph('bookcase', 'bc'), ph('armchair', 'arm'));
  return { task: { purpose: ['office'], people: 1 }, project: p, concepts: [
    { key: 'c1', name: 'Рабочее место у окна', relations: [rel('r1', 'near_window', 'desk'), rel('r2', 'against_wall', 'bc', null, { wall: 'W2' })] },
    { key: 'c2', name: 'Стол у длинной стены', relations: [rel('r1', 'against_wall', 'desk', null, { wall: 'W4' }), rel('r2', 'away_from_window', 'arm')] },
  ] };
});
fx('L-5x5', 'Г-образная 5×5: гостиная и столовая', () => {
  const p = room([[0, 0], [5000, 0], [5000, 2500], [2500, 2500], [2500, 5000], [0, 5000]]); door(p, 5, 500, 900); win(p, 1, 2000, 1500); win(p, 2, 'center', 1200);
  add(p, ph('sofa', 'sofa'), ph('coffee-table', 'ct'), ph('table', 'table'), ph('chair', 'ch1'), ph('chair', 'ch2'), ph('chair', 'ch3'), ph('chair', 'ch4'));
  return { task: { purpose: ['living', 'dining'], people: 4 }, project: p, concepts: [
    { key: 'c1', name: 'Стол в узкой части', zones: [{ id: 'z1', kind: 'dining', region: 'R1' }], hints: [{ itemId: 'table', zone: 'z1' }], relations: [rel('r1', 'around', ['ch1', 'ch2', 'ch3', 'ch4'], 'table'), rel('r2', 'in_front_of', 'ct', 'sofa')] },
    { key: 'c2', name: 'Диван в углу Г', relations: [rel('r1', 'against_wall', 'sofa', null, { wall: 'W6' }), rel('r2', 'around', ['ch1', 'ch2', 'ch3', 'ch4'], 'table')] },
  ] };
});
fx('L-7x5.6-studio', 'Г-образная студия 7×5,6: спальня и гостиная', () => {
  const p = room([[0, 0], [7000, 0], [7000, 5600], [3500, 5600], [3500, 3000], [0, 3000]]); door(p, 4, 600, 900); win(p, 1, 1500, 1500); win(p, 2, 2000, 1500);
  add(p, ph('bed', 'bed', { form: 'double' }), ph('nightstand', 'ns1'), ph('sofa', 'sofa'), ph('coffee-table', 'ct'), ph('wardrobe', 'ward'), ph('desk', 'desk'), ph('office-chair', 'och'));
  return { task: { purpose: ['bedroom', 'living'], people: 2 }, project: p, concepts: [
    { key: 'c1', name: 'Кровать в дальней части', relations: [rel('r1', 'away_from_entrance', 'bed'), rel('r2', 'in_front_of', 'ct', 'sofa')] },
    { key: 'c2', name: 'Диван у окна', relations: [rel('r1', 'near_window', 'sofa'), rel('r2', 'against_wall', 'bed', null, { wall: 'W3' })] },
  ] };
});
fx('cut-corner', 'Спальня со срезанным углом', () => {
  const p = room([[0, 0], [3500, 0], [4200, 700], [4200, 4200], [0, 4200]]); door(p, 5, 400, 800); win(p, 1, 'center', 1400);
  add(p, ph('bed', 'bed', { form: 'double' }), ph('nightstand', 'ns1'), ph('nightstand', 'ns2'), ph('dresser', 'dr'));
  return { task: { purpose: ['bedroom'] }, project: p, concepts: [{ key: 'c1', name: 'Кровать по центру стены', relations: [rel('r1', 'centered_on_wall', 'bed', null, { wall: 'W3' })] }] };
});
fx('trapezoid-1', 'Пустая спальня-трапеция, ИИ добавляет', () => {
  const p = room([[0, 0], [4000, 0], [4000, 4000], [0, 4000 - Math.round(4000 * Math.tan(Math.PI / 6))]]); door(p, 3, 700, 800); win(p, 2, 'center', 1400);
  return { task: { purpose: ['bedroom'], allowAdd: true }, project: p, concepts: [
    { key: 'c1', name: 'Спальня', relations: [rel('r1', 'against_wall', 'add-bed', null, { wall: 'W1' })], additions: [{ tempId: 'add-bed', typeId: 'bed', formId: 'double', reason: 'Спальне нужна кровать' }, { tempId: 'add-ns1', typeId: 'nightstand', reason: 'Тумба у кровати' }, { tempId: 'add-ns2', typeId: 'nightstand', reason: 'Вторая тумба' }, { tempId: 'add-ward', typeId: 'wardrobe', reason: 'Хранение одежды' }] },
  ] };
});
fx('trapezoid-2', 'Гостиная-трапеция с двумя косыми стенами', () => {
  const p = room([[800, 0], [4200, 0], [5000, 4500], [0, 4500]]); door(p, 3, 600, 900); win(p, 1, 'center', 1600);
  add(p, ph('sofa', 'sofa'), ph('armchair', 'arm'), ph('coffee-table', 'ct'), ph('tv-stand', 'tvs'), ph('shelving', 'shelf'));
  return { project: p, concepts: [{ key: 'c1', name: 'Диван у окна', relations: [rel('r1', 'against_wall', 'sofa', null, { wall: 'W3' }), rel('r2', 'opposite', 'tvs', 'sofa'), rel('r3', 'in_front_of', 'ct', 'sofa')] }] };
});
fx('hexagon', 'Шестиугольник с пустышкой углового дивана', () => {
  const p = regular(6, 2500); door(p, 4, 800, 900); win(p, 1, 'center', 1400);
  add(p, ph('sofa', 'sofa', { form: 'corner' }), ph('coffee-table', 'ct'), ph('armchair', 'arm'));
  return { project: p, concepts: [{ key: 'c1', name: 'Диван в углу', relations: [rel('r1', 'in_corner', 'sofa'), rel('r2', 'in_front_of', 'ct', 'sofa')] }] };
});
fx('hexagon-corner-anchored', 'Шестиугольник: угловой диван «Оставить на месте» без прямых углов', () => {
  const p = regular(6, 2500); door(p, 4, 800, 900);
  // пустышка стоит вплотную к косой стене: от точки привязки ни один товар не встаёт (ТЗ §28.5 п. 3)
  const s = freeAt(item('sofa', { id: 'sofa', form: 'corner', policy: 'replace' }), 1200, 2500, 0);
  add(p, s);
  return { project: p, expect: { feasible: false, codes: ['OUTSIDE'] }, concepts: [{ key: 'c1', name: 'Как есть', relations: [] }] };
});
fx('hexagon-irregular', 'Неправильный шестиугольник: кабинет', () => {
  const p = room([[1000, 0], [4000, 0], [5200, 1800], [4400, 4200], [800, 4200], [0, 1800]]); door(p, 5, 500, 800); win(p, 1, 'center', 1400); win(p, 3, 'center', 1200);
  add(p, ph('desk', 'desk'), ph('office-chair', 'och'), ph('bookcase', 'bc'), ph('shelving', 'shelf'), ph('armchair', 'arm'));
  return { task: { purpose: ['office'], people: 1 }, project: p, concepts: [{ key: 'c1', name: 'Стол у окна', relations: [rel('r1', 'near_window', 'desk'), rel('r2', 'in_front_of', 'och', 'desk')] }] };
});
fx('halfhex-trapezoid', 'Половина шестиугольника + трапеция: столовая', () => {
  const p = room([[0, 1300], [1500, 0], [4500, 0], [6000, 1300], [6000, 3500], [5000, 5000], [1000, 5000], [0, 3500]]); door(p, 7, 800, 900); win(p, 2, 'center', 2000);
  add(p, ph('table', 'table'), ph('chair', 'ch1'), ph('chair', 'ch2'), ph('chair', 'ch3'), ph('chair', 'ch4'), ph('sideboard', 'sb'));
  return { task: { purpose: ['dining'], people: 4 }, project: p, concepts: [{ key: 'c1', name: 'Стол по центру', relations: [rel('r1', 'around', ['ch1', 'ch2', 'ch3', 'ch4'], 'table'), rel('r2', 'against_wall', 'sb')] }] };
});
fx('heptagon-acute', 'Семиугольник с острым углом: детская', () => {
  const p = room([[0, 0], [3800, 0], [5200, 900], [4200, 3800], [2400, 4400], [600, 3800], [1800, 1600]]); door(p, 5, 600, 800); win(p, 1, 'center', 1400);
  add(p, ph('kids-bed', 'bed'), ph('desk', 'desk'), ph('chair', 'chair'), ph('shelving', 'shelf'));
  return { task: { purpose: ['kids'], people: 1 }, project: p, concepts: [{ key: 'c1', name: 'Кровать у стены', relations: [rel('r1', 'against_wall', 'bed'), rel('r2', 'in_front_of', 'chair', 'desk')] }] };
});
fx('protrusion', 'Гостиная с коробом (угол больше 180°)', () => {
  const p = room([[0, 0], [4500, 0], [4500, 2000], [3900, 2000], [3900, 2600], [4500, 2600], [4500, 5000], [0, 5000]]); door(p, 8, 500, 900); win(p, 1, 'center', 1600);
  add(p, ph('sofa', 'sofa'), ph('coffee-table', 'ct'), ph('tv-stand', 'tvs'), ph('armchair', 'arm'), ph('bookcase', 'bc'));
  return { project: p, concepts: [{ key: 'c1', name: 'Диван у глухой стены', relations: [rel('r1', 'against_wall', 'sofa', null, { wall: 'W7' }), rel('r2', 'opposite', 'tvs', 'sofa'), rel('r3', 'in_front_of', 'ct', 'sofa')] }] };
});
fx('open-8x9', 'Большая открытая 8×9: гостиная и столовая', () => {
  const p = rect(8000, 9000); door(p, 4, 700, 1000); win(p, 1, 1500, 1800); win(p, 1, 5000, 1800); win(p, 2, 'center', 1800);
  add(p, ph('sofa', 'sofa', { form: 'corner' }), ph('coffee-table', 'ct'), ph('armchair', 'arm1'), ph('armchair', 'arm2'), ph('tv-stand', 'tvs'), ph('tv', 'tv'), ph('bookcase', 'bc'), ph('table', 'table'), ph('chair', 'ch1'), ph('chair', 'ch2'), ph('chair', 'ch3'), ph('chair', 'ch4'), ph('chair', 'ch5'), ph('chair', 'ch6'), ph('sideboard', 'sb'), ph('rug', 'rug'));
  return { task: { purpose: ['living', 'dining'], people: 6 }, project: p, concepts: [
    { key: 'c1', name: 'Две зоны', relations: [rel('r1', 'in_corner', 'sofa'), rel('r2', 'in_front_of', 'ct', 'sofa'), rel('r3', 'around', ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6'], 'table'), rel('r4', 'under', 'rug', 'sofa'), rel('r5', 'opposite', 'tvs', 'sofa')] },
  ] };
});
fx('huge-30x30', 'Предельная 30×30', () => {
  const p = rect(30000, 30000); door(p, 4, 1000, 1000); win(p, 1, 'center', 3000);
  add(p, ph('sofa', 'sofa'), ph('coffee-table', 'ct'), ph('table', 'table'), ph('chair', 'ch1'), ph('chair', 'ch2'));
  return { project: p, concepts: [{ key: 'c1', name: 'Зона отдыха', relations: [rel('r1', 'in_front_of', 'ct', 'sofa'), rel('r2', 'around', ['ch1', 'ch2'], 'table')] }] };
});
fx('tiny-1x1', 'Предельная 1×1', () => {
  const p = rect(1000, 1000); door(p, 3, 100, 700);
  add(p, ph('plant', 'plant', { product: 'p-plant-round-S' }));
  return { project: p, concepts: [{ key: 'c1', name: 'Растение', relations: [] }] };
});

/* ---------- Назначения ---------- */
fx('kitchen-dining', 'Кухня-столовая: кухня «Ничего не делать», стол и стулья', () => {
  const p = rect(3600, 4500); door(p, 3, 400, 800); win(p, 1, 'center', 1400);
  const kb = atWall(p, item('kitchen-base', { id: 'kb', product: 'p-kitchen-base-rect-L', policy: 'keep' }), 2, 1200, 0);
  const fr = atWall(p, item('fridge', { id: 'fridge', product: 'p-fridge-rect-M', policy: 'keep' }), 2, 2700, 0);
  const sink = onBase(item('sink', { id: 'sink', product: 'p-sink-rect-M', policy: 'keep' }), kb);
  const kw = onWall(p, item('kitchen-wall', { id: 'kw', product: 'p-kitchen-wall-wall-L', policy: 'keep' }), 2, 1200, 1450);
  add(p, kb, fr, sink, kw, ph('table', 'table'), ph('chair', 'ch1'), ph('chair', 'ch2'), ph('chair', 'ch3'));
  return { task: { purpose: ['kitchen', 'dining'], people: 3 }, project: p, concepts: [{ key: 'c1', name: 'Стол у окна', relations: [rel('r1', 'near_window', 'table'), rel('r2', 'around', ['ch1', 'ch2', 'ch3'], 'table')] }] };
});
fx('bath-1.7x2.2', 'Ванная 1,7×2,2: сантехника на местах, замена раковины', () => {
  const p = rect(1700, 2200); door(p, 3, 150, 700, { swing: 'out' });
  const tub = atWall(p, item('bathtub', { id: 'tub', product: 'p-bathtub-rect-M', policy: 'keep' }), 1, 850, 0);
  const wc = atWall(p, item('toilet', { id: 'wc', product: 'p-toilet-rect-M', policy: 'keep' }), 2, 1500, 0);
  const wb = atWall(p, item('washbasin', { id: 'wb', product: 'p-washbasin-rect-M', policy: 'replace' }), 4, 1100, 0);
  const tr = onWall(p, item('towel-rail', { id: 'tr', policy: 'keep' }), 4, 400, 900);
  add(p, tub, wc, wb, tr);
  return { task: { purpose: ['bath'] }, project: p, concepts: [{ key: 'c1', name: 'Замена раковины', relations: [] }] };
});
fx('toilet-1x2', 'Туалет 1×2: полка', () => {
  const p = rect(1000, 2000); door(p, 3, 150, 700, { swing: 'out' });
  const wc = atWall(p, item('toilet', { id: 'wc', product: 'p-toilet-rect-M', policy: 'keep' }), 1, 500, 0);
  add(p, wc, ph('wall-shelf', 'shelf'));
  return { task: { purpose: ['toilet'] }, project: p, concepts: [{ key: 'c1', name: 'Полка над унитазом', relations: [rel('r1', 'same_wall', 'shelf', 'wc')] }] };
});
fx('hall-1.5x3.6', 'Прихожая 1,5×3,6', () => {
  const p = rect(1500, 3600); door(p, 3, 350, 800, { name: 'Входная' }); door(p, 1, 350, 800, { swing: 'out' });
  add(p, ph('shoe-rack', 'shoes'), ph('coat-rack', 'coat', { form: 'wall' }), ph('bench', 'bench'), ph('mirror', 'mirror'));
  return { task: { purpose: ['hall'], people: 2 }, project: p, concepts: [{ key: 'c1', name: 'Всё у входа', relations: [rel('r1', 'near_entrance', 'shoes'), rel('r2', 'near_entrance', 'bench')] }] };
});
fx('studio', 'Студия: спальное место и гостиная', () => {
  const p = rect(5000, 6000); door(p, 3, 500, 900); win(p, 1, 1200, 1500); win(p, 2, 'center', 1500);
  add(p, ph('bed', 'bed', { form: 'double' }), ph('nightstand', 'ns'), ph('sofa', 'sofa'), ph('coffee-table', 'ct'), ph('tv-stand', 'tvs'), ph('desk', 'desk'), ph('chair', 'chair'), ph('wardrobe', 'ward'));
  return { task: { purpose: ['bedroom', 'living'], people: 2 }, project: p, concepts: [
    { key: 'c1', name: 'Кровать у окна', relations: [rel('r1', 'near_window', 'bed'), rel('r2', 'away_from_window', 'sofa'), rel('r3', 'opposite', 'tvs', 'sofa')] },
    { key: 'c2', name: 'Кровать в глубине', relations: [rel('r1', 'away_from_entrance', 'bed'), rel('r2', 'near_entrance', 'ward')] },
  ] };
});

/* ---------- Проёмы ---------- */
fx('no-door', 'Кабинет без двери (вход предполагается)', () => {
  const p = rect(3500, 4000); win(p, 1, 'center', 1400);
  add(p, ph('desk', 'desk'), ph('office-chair', 'och'), ph('shelving', 'shelf'));
  return { task: { purpose: ['office'], people: 1 }, project: p, concepts: [{ key: 'c1', name: 'Стол у окна', relations: [rel('r1', 'near_window', 'desk')] }] };
});
fx('three-doors', 'Гостиная с тремя дверями', () => {
  const p = rect(4500, 5000); door(p, 4, 500, 900); door(p, 2, 3600, 800, { hinge: 'right' }); door(p, 1, 300, 800, { swing: 'out' }); win(p, 3, 'center', 1600);
  add(p, ph('sofa', 'sofa'), ph('coffee-table', 'ct'), ph('armchair', 'arm'), ph('bookcase', 'bc'));
  return { project: p, concepts: [{ key: 'c1', name: 'Диван у окна', relations: [rel('r1', 'against_wall', 'sofa', null, { wall: 'W3' }), rel('r2', 'in_front_of', 'ct', 'sofa')] }] };
});
fx('arch-french', 'Столовая: арка, дверь наружу, французское окно', () => {
  const p = rect(4000, 4500); arch(p, 4, 800, 1200); door(p, 3, 400, 800, { swing: 'out' }); win(p, 1, 'center', 1600, { sill: 0, height: 2200 }); win(p, 2, 'center', 1200);
  add(p, ph('table', 'table'), ph('chair', 'ch1'), ph('chair', 'ch2'), ph('chair', 'ch3'), ph('chair', 'ch4'), ph('showcase', 'sc'));
  return { task: { purpose: ['dining'], people: 4 }, project: p, concepts: [{ key: 'c1', name: 'Стол у окна', relations: [rel('r1', 'around', ['ch1', 'ch2', 'ch3', 'ch4'], 'table'), rel('r2', 'near_window', 'table')] }] };
});
fx('radiators-two-windows', 'Спальня: окна на двух стенах, радиаторы под окнами', () => {
  const p = rect(3800, 4200); door(p, 3, 500, 800); win(p, 1, 'center', 1400); win(p, 2, 'center', 1200); radiatorUnder(p, 1, 1900, 'rad1'); radiatorUnder(p, 2, 2100, 'rad2');
  add(p, ph('bed', 'bed', { form: 'double' }), ph('nightstand', 'ns1'), ph('nightstand', 'ns2'), ph('wardrobe', 'ward'), ph('dresser', 'dr'));
  return { task: { purpose: ['bedroom'] }, project: p, concepts: [{ key: 'c1', name: 'Кровать у глухой стены', relations: [rel('r1', 'against_wall', 'bed', null, { wall: 'W4' })] }] };
});

/* ---------- Потолок ---------- */
fx('ceiling-2.1', 'Потолок 2,1 м: высокие шкафы отсекаются', () => {
  const p = rect(3500, 4000, { height: 2100 }); door(p, 3, 400, 800); win(p, 1, 'center', 1400);
  add(p, ph('wardrobe', 'ward'), ph('bed', 'bed', { form: 'double' }));
  return { task: { purpose: ['bedroom'] }, project: p, concepts: [{ key: 'c1', name: 'Шкаф у стены', relations: [rel('r1', 'against_wall', 'ward')] }] };
});
fx('ceiling-2.1-bunk', 'Потолок 2,1 м: двухъярусная кровать не помещается', () => {
  const p = rect(3500, 4000, { height: 2100 }); door(p, 3, 400, 800);
  add(p, ph('kids-bed', 'bed', { form: 'bunk' }));
  return { task: { purpose: ['kids'] }, project: p, expect: { feasible: false, codes: ['CEILING'] }, concepts: [{ key: 'c1', name: 'Двухъярусная', relations: [] }] };
});
fx('ceiling-3.5', 'Потолок 3,5 м', () => {
  const p = rect(4000, 5000, { height: 3500 }); door(p, 4, 500, 900); win(p, 1, 'center', 1600);
  add(p, ph('sofa', 'sofa'), ph('shelving', 'sh1'), ph('shelving', 'sh2'), ph('bookcase', 'bc'));
  return { project: p, concepts: [{ key: 'c1', name: 'Стеллажи по бокам', relations: [rel('r1', 'against_wall', 'sh1', null, { wall: 'W2' }), rel('r2', 'same_wall', 'sh2', 'sh1')] }] };
});

/* ---------- Состав ---------- */
fx('empty-add-living', 'Пустая гостиная, ИИ добавляет', () => {
  const p = rect(4200, 5000); door(p, 4, 500, 900); win(p, 1, 'center', 1600);
  return { task: { allowAdd: true }, project: p, concepts: [{ key: 'c1', name: 'Гостиная', relations: [rel('r1', 'in_front_of', 'a-ct', 'a-sofa'), rel('r2', 'opposite', 'a-tvs', 'a-sofa')], additions: [{ tempId: 'a-sofa', typeId: 'sofa', reason: 'Гостиной нужен диван' }, { tempId: 'a-ct', typeId: 'coffee-table', reason: 'Столик у дивана' }, { tempId: 'a-tvs', typeId: 'tv-stand', reason: 'Место под ТВ' }, { tempId: 'a-arm', typeId: 'armchair', reason: 'Ещё одно место' }] }] };
});
fx('only-placeholders', 'Спальня только из пустышек', () => {
  const p = rect(3600, 4000); door(p, 4, 400, 800); win(p, 2, 'center', 1400);
  add(p, ph('bed', 'bed', { form: 'king' }), ph('nightstand', 'ns1'), ph('nightstand', 'ns2'), ph('wardrobe', 'ward', { constraints: { W: { mode: 'range', min: 1400, max: 2200 } } }), ph('bench', 'bench'));
  return { task: { purpose: ['bedroom'] }, project: p, concepts: [{ key: 'c1', name: 'Кровать напротив окна', relations: [rel('r1', 'against_wall', 'bed', null, { wall: 'W4' })] }] };
});
fx('all-keep-but-one', 'Всё «Ничего не делать», кроме кресла', () => {
  const p = rect(4000, 5000); door(p, 4, 500, 900); win(p, 1, 'center', 1600);
  const sofa = atWall(p, item('sofa', { id: 'sofa', product: 'p-sofa-straight-M', policy: 'keep' }), 3, 2000, 50);
  const ct = freeAt(item('coffee-table', { id: 'ct', product: 'p-coffee-table-rect-M', policy: 'keep' }), 2000, 3600, 0);
  const tvs = atWall(p, item('tv-stand', { id: 'tvs', product: 'p-tv-stand-rect-M', policy: 'keep' }), 2, 2500, 0);
  add(p, sofa, ct, tvs, item('armchair', { id: 'arm', product: 'p-armchair-rect-M', policy: 'free' }));
  return { project: p, concepts: [{ key: 'c1', name: 'Кресло к дивану', relations: [rel('r1', 'beside', 'arm', 'sofa')] }] };
});
fx('base-item', 'Тумба перемещается вместе с лампой на ней', () => {
  const p = rect(3400, 3800); door(p, 3, 300, 800); win(p, 1, 'center', 1200);
  const bed = atWall(p, item('bed', { id: 'bed', product: 'p-bed-double-M', policy: 'keep' }), 2, 1900, 0);
  const ns = freeAt(item('nightstand', { id: 'ns', product: 'p-nightstand-rect-M', policy: 'move' }), 1200, 2400, 0);
  const lamp = onBase(item('table-lamp', { id: 'lamp', product: 'p-table-lamp-round-M', policy: 'keep' }), ns);
  add(p, bed, ns, lamp);
  return { task: { purpose: ['bedroom'] }, project: p, concepts: [{ key: 'c1', name: 'Тумба у кровати', relations: [rel('r1', 'beside', 'ns', 'bed')] }] };
});
fx('inherited-violation', 'Неподвижный диван перекрывает открывание двери', () => {
  const p = rect(4000, 4500); door(p, 4, 400, 900); win(p, 1, 'center', 1400);
  const sofa = freeAt(item('sofa', { id: 'sofa', product: 'p-sofa-straight-S', policy: 'keep' }), 900, 3200, 90);
  add(p, sofa, ph('coffee-table', 'ct'), ph('bookcase', 'bc'));
  return { project: p, concepts: [{ key: 'c1', name: 'Как есть', relations: [rel('r1', 'in_front_of', 'ct', 'sofa')] }] };
});
fx('outside-items', 'Предметы за пределами комнаты', () => {
  const p = rect(3600, 4000); door(p, 3, 400, 800); win(p, 1, 'center', 1400);
  const w = freeAt(item('wardrobe', { id: 'ward', product: 'p-wardrobe-rect-M', policy: 'keep' }), 6000, 2000, 0);
  const a = freeAt(item('armchair', { id: 'arm', product: 'p-armchair-rect-M', policy: 'free' }), -1500, 1500, 0);
  add(p, w, a, ph('sofa', 'sofa'));
  return { project: p, concepts: [{ key: 'c1', name: 'Кресло внутрь', relations: [rel('r1', 'beside', 'arm', 'sofa')] }] };
});
fx('forty-items', '40 предметов (производительность)', () => {
  const p = rect(9000, 10000); door(p, 4, 800, 1000); door(p, 2, 7000, 900); win(p, 1, 1500, 1800); win(p, 1, 5500, 1800);
  const its = [ph('sofa', 'sofa', { form: 'corner' }), ph('coffee-table', 'ct'), ph('armchair', 'arm1'), ph('armchair', 'arm2'), ph('tv-stand', 'tvs'), ph('tv', 'tv'), ph('bookcase', 'bc1'), ph('bookcase', 'bc2'), ph('shelving', 'sh1'), ph('shelving', 'sh2'), ph('table', 'table'), ph('sideboard', 'sb'), ph('console', 'cons'), ph('desk', 'desk'), ph('office-chair', 'och'), ph('pouf', 'pouf1'), ph('pouf', 'pouf2'), ph('floor-lamp', 'fl'), ph('plant', 'pl1'), ph('plant', 'pl2'), ph('showcase', 'sc'), ph('dresser', 'dr'), ph('rug', 'rug')];
  for (let i = 1; i <= 8; i++) its.push(ph('chair', 'ch' + i));
  for (let i = 1; i <= 4; i++) its.push(ph('wall-shelf', 'ws' + i));
  for (let i = 1; i <= 3; i++) its.push(ph('picture', 'pic' + i));
  its.push(ph('small-table', 'st1'), ph('small-table', 'st2'));
  add(p, ...its);
  return { task: { purpose: ['living', 'dining'], people: 8 }, project: p, concepts: [
    { key: 'c1', name: 'Три зоны', relations: [rel('r1', 'in_corner', 'sofa'), rel('r2', 'in_front_of', 'ct', 'sofa'), rel('r3', 'around', ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'ch7', 'ch8'], 'table'), rel('r4', 'near_window', 'desk'), rel('r5', 'opposite', 'tvs', 'sofa')] },
    { key: 'c2', name: 'Стол у окна', relations: [rel('r1', 'near_window', 'table'), rel('r2', 'around', ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'ch7', 'ch8'], 'table'), rel('r3', 'in_front_of', 'ct', 'sofa')] },
    { key: 'c3', name: 'Диван у длинной стены', relations: [rel('r1', 'against_wall', 'sofa', null, { wall: 'W2' }), rel('r2', 'in_front_of', 'ct', 'sofa'), rel('r3', 'around', ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'ch7', 'ch8'], 'table')] },
    { key: 'c4', name: 'Рабочее место в углу', relations: [rel('r1', 'in_corner', 'desk'), rel('r2', 'around', ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'ch7', 'ch8'], 'table')] },
  ] };
});

/* ---------- Бюджет ---------- */
fx('budget-strict-tight', 'Строгий бюджет впритык', () => {
  const p = rect(3500, 4000); door(p, 4, 400, 800); win(p, 1, 'center', 1400);
  add(p, ph('sofa', 'sofa'), ph('coffee-table', 'ct'));
  return { task: { budget: { mode: 'strict', amount: 33000, currency: 'RUB' } }, project: p, concepts: [{ key: 'c1', name: 'Диван и столик', relations: [rel('r1', 'in_front_of', 'ct', 'sofa')] }] };
});
fx('budget-strict-impossible', 'Строгий бюджет невыполним', () => {
  const p = rect(3500, 4000); door(p, 4, 400, 800); win(p, 1, 'center', 1400);
  add(p, ph('sofa', 'sofa'), ph('wardrobe', 'ward'));
  return { task: { budget: { mode: 'strict', amount: 10000, currency: 'RUB' } }, project: p, expect: { feasible: false, codes: ['BUDGET'] }, concepts: [{ key: 'c1', name: 'Диван и шкаф', relations: [] }] };
});
fx('budget-over-10', 'Бюджет +10%', () => {
  const p = rect(3500, 4000); door(p, 4, 400, 800); win(p, 1, 'center', 1400);
  add(p, ph('bed', 'bed', { form: 'double' }), ph('nightstand', 'ns1'));
  return { task: { purpose: ['bedroom'], budget: { mode: 'over', amount: 75000, currency: 'RUB', overPct: 10 } }, project: p, concepts: [{ key: 'c1', name: 'Кровать', relations: [] }] };
});
fx('budget-target', 'Бюджет-ориентир', () => {
  const p = rect(3500, 4000); door(p, 4, 400, 800); win(p, 1, 'center', 1400);
  add(p, ph('desk', 'desk'), ph('office-chair', 'och'), ph('bookcase', 'bc'));
  return { task: { purpose: ['office'], people: 1, budget: { mode: 'target', amount: 50000, currency: 'RUB' } }, project: p, concepts: [{ key: 'c1', name: 'Кабинет', relations: [rel('r1', 'near_window', 'desk')] }] };
});

module.exports = F;
module.exports.byId = (id) => F.find(f => f.id === id);
