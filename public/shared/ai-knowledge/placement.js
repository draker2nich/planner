/* =====================================================================
   Как предмет ставится: способы постановки, зазоры, зоны обслуживания, высоты настенных,
   группы и программы комнат, словарь отношений (ТЗ §14.2–§14.5, §18.6, прил. А).
   Все числа — данные: их можно менять без правки солвера. Локальная система предмета:
   перед = +y, тыл = −y, левый бок = −x, правый = +x (до зеркала).
   Браузер: глобальный AIPlacement. Node: require('./placement.js').
   ===================================================================== */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  // eslint-disable-next-line no-undef
  const api = factory(isNode ? require('../catalog-types.js') : { TYPES, TYPE, formOf });
  if (isNode) module.exports = api; else root.AIPlacement = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CT) {
  'use strict';
  const VERSION = 'placement-1';

  /* Зоны обслуживания по виду фасада (ТЗ §14.3): [жёстко, рекомендуется], мм. drawers — «глубина ящика + …» */
  const DOOR_ZONES = { hinged: [600, 800], sliding: [500, 600], drawers: 'depth', open: [450, 600], none: null };
  const DRAWERS_ADD = [250, 400];

  const Z = (side, hard, soft, extra) => Object.assign({ side, hard, soft }, extra || {});
  const DOOR = (def) => ({ side: 'front', door: true, defaultDoor: def });
  const DRAWERS = () => ({ side: 'front', drawers: true });
  const BEDSIDE = (hard, soft, from) => [Z('left', hard, soft, { oneOf: 'bedside', from }), Z('right', hard, soft, { oneOf: 'bedside', from })];

  /* Способы постановки: wall, corner, free, near, ontop, wallMount, under, ceiling (ТЗ §14.2).
     byForm — переопределения для отдельных форм. rank — anchorRank (0 — инженерное, не двигается). */
  const P = {
    sofa: { placement: ['wall', 'free'], byForm: { corner: ['corner', 'wall'], u: ['wall', 'free'] }, backGap: [0, 150], underWindow: true, rank: 1, zones: [Z('front', 350, 450)] },
    armchair: { placement: ['near', 'wall', 'free'], backGap: [0, 150], underWindow: true, rank: 2, zones: [Z('front', 350, 450)] },
    pouf: { placement: ['near', 'free'], underWindow: true, rank: 3, zones: [] },
    beanbag: { placement: ['free', 'corner'], underWindow: true, rank: 3, zones: [] },
    'coffee-table': { placement: ['near', 'free'], underWindow: true, rank: 3, zones: [Z('around', 300, 450)] },
    'tv-stand': { placement: ['wall'], underWindow: true, rank: 2, zones: [Z('front', 450, 600)] },
    tv: { placement: ['wallMount'], byForm: { stand: ['ontop'] }, underWindow: false, rank: 2, zones: [], anchorV: 'center', elevation: { min: 1000, max: 1250, ref: 'center' } },
    shelving: { placement: ['wall', 'corner'], underWindow: false, rank: 2, zones: [Z('front', 450, 600)] },
    bookcase: { placement: ['wall'], underWindow: false, rank: 2, zones: [DOOR('open')] },
    showcase: { placement: ['wall', 'corner'], underWindow: false, rank: 2, zones: [DOOR('hinged')] },
    console: { placement: ['wall'], underWindow: true, rank: 2, zones: [Z('front', 450, 600)] },
    fireplace: { placement: ['wall'], byForm: { corner: ['corner'] }, underWindow: false, rank: 1, zones: [Z('front', 600, 900)] },
    rug: { placement: ['under', 'free'], underWindow: true, rank: 3, zones: [] },
    'floor-lamp': { placement: ['corner', 'near'], underWindow: true, rank: 3, zones: [] },
    'table-lamp': { placement: ['ontop'], underWindow: true, rank: 3, zones: [] },
    plant: { placement: ['corner', 'free'], underWindow: true, rank: 3, zones: [] },
    bed: { placement: ['wall'], backGap: [0, 100], underWindow: true, rank: 1, zones: [], bedZones: true },
    nightstand: { placement: ['near'], underWindow: true, rank: 3, zones: [DRAWERS()] },
    dresser: { placement: ['wall'], underWindow: true, rank: 2, zones: [DRAWERS()] },
    wardrobe: { placement: ['wall'], byForm: { corner: ['corner'] }, underWindow: false, rank: 1, zones: [DOOR('hinged')] },
    'closet-system': { placement: ['wall'], byForm: { corner: ['corner'] }, underWindow: false, rank: 1, zones: [DOOR('open')] },
    'dressing-table': { placement: ['wall'], underWindow: true, rank: 2, zones: [Z('front', 600, 750)] },
    bench: { placement: ['near', 'wall'], underWindow: true, rank: 3, zones: [Z('front', 350, 450)] },
    mirror: { placement: ['wallMount'], byForm: { floor: ['wall', 'corner'] }, underWindow: false, rank: 3, zones: [], formZones: { floor: [Z('front', 600, 800)] }, anchorV: 'center', elevation: { min: 1000, max: 1400, def: 1200, ref: 'bottom' } },
    'kids-bed': { placement: ['wall', 'corner'], underWindow: true, byFormUnderWindow: { bunk: false }, rank: 1, zones: [], bedZones: true, formZones: { crib: [Z('front', 600, 700)] } },
    'changing-table': { placement: ['wall'], underWindow: true, rank: 2, zones: [Z('front', 600, 800)] },
    desk: { placement: ['wall', 'near', 'free'], byForm: { corner: ['corner'] }, underWindow: true, rank: 1, zones: [Z('front', 750, 900)] },
    chair: { placement: ['near'], underWindow: true, rank: 3, zones: [] },
    'toy-house': { placement: ['free', 'corner'], underWindow: false, rank: 3, zones: [] },
    'kitchen-base': { placement: ['wall'], byForm: { corner: ['corner'] }, underWindow: true, rank: 1, zones: [Z('front', 900, 1200)] },
    'kitchen-wall': { placement: ['wallMount'], underWindow: false, rank: 2, zones: [], anchorV: 'bottom' },
    island: { placement: ['free'], underWindow: true, rank: 1, zones: [Z('around', 900, 1200)] },
    sink: { placement: ['ontop'], underWindow: true, rank: 2, zones: [] },
    stove: { placement: ['wall'], byForm: { hob: ['ontop'] }, underWindow: false, rank: 2, zones: [Z('front', 900, 1200)], formZones: { hob: [] } },
    oven: { placement: ['ontop'], underWindow: true, rank: 3, zones: [Z('front', 700, 900)] },
    hood: { placement: ['wallMount'], underWindow: false, rank: 2, zones: [], anchorV: 'bottom' },
    fridge: { placement: ['wall', 'corner'], underWindow: false, rank: 2, zones: [Z('front', 700, 1000)] },
    dishwasher: { placement: ['wall'], underWindow: true, rank: 2, zones: [Z('front', 700, 900)] },
    microwave: { placement: ['ontop'], underWindow: true, rank: 3, zones: [] },
    table: { placement: ['free', 'wall'], underWindow: true, rank: 1, zones: [Z('around', 700, 900, { seats: true, passBehind: 1100 })] },
    'bar-counter': { placement: ['wall', 'free'], underWindow: false, rank: 1, zones: [Z('front', 700, 900)] },
    'bar-stool': { placement: ['near'], underWindow: true, rank: 3, zones: [] },
    washer: { placement: ['wall'], underWindow: true, rank: 2, zones: [Z('front', 700, 900)] },
    dryer: { placement: ['ontop'], underWindow: true, rank: 2, zones: [Z('front', 700, 900)] },
    sideboard: { placement: ['wall'], underWindow: true, rank: 2, zones: [DOOR('hinged')] },
    bathtub: { placement: ['wall'], byForm: { corner: ['corner'], oval: ['free', 'wall'] }, underWindow: true, rank: 1, zones: [Z('front', 600, 700)] },
    shower: { placement: ['corner', 'wall'], underWindow: false, rank: 1, zones: [Z('front', 600, 700)] },
    washbasin: { placement: ['wall'], byForm: { wall: ['wallMount'], top: ['ontop'] }, underWindow: true, rank: 1, zones: [Z('front', 700, 800)], formZones: { top: [] }, anchorV: 'bottom' },
    vanity: { placement: ['wall'], underWindow: true, rank: 2, zones: [Z('front', 700, 800)] },
    toilet: { placement: ['wall'], byForm: { wall: ['wallMount'] }, underWindow: true, rank: 1, zones: [Z('front', 600, 750)], lateral: [350, 400], anchorV: 'bottom' },
    bidet: { placement: ['wall'], underWindow: true, rank: 1, zones: [Z('front', 600, 750)], lateral: [350, 400] },
    'towel-rail': { placement: ['wallMount'], underWindow: true, rank: 0, zones: [], anchorV: 'bottom' },
    'tall-cabinet': { placement: ['wall', 'corner'], underWindow: false, rank: 2, zones: [DOOR('hinged')] },
    boiler: { placement: ['wallMount'], underWindow: true, rank: 0, zones: [], anchorV: 'bottom' },
    'wall-shelf': { placement: ['wallMount'], underWindow: false, rank: 3, zones: [], anchorV: 'bottom', elevation: { min: 300, max: 2000, def: 1500, ref: 'bottom' } },
    'coat-rack': { placement: ['near', 'wall', 'corner'], byForm: { wall: ['wallMount'] }, underWindow: false, rank: 3, zones: [Z('front', 450, 600)], formZones: { wall: [] }, anchorV: 'bottom', elevation: { min: 1600, max: 1800, ref: 'bottom' } },
    'shoe-rack': { placement: ['wall', 'near'], underWindow: true, rank: 3, zones: [Z('front', 450, 600)] },
    'meeting-table': { placement: ['free'], underWindow: true, rank: 1, zones: [Z('around', 700, 900, { seats: true })] },
    'office-chair': { placement: ['near'], underWindow: true, rank: 3, zones: [] },
    pedestal: { placement: ['near'], underWindow: true, rank: 3, zones: [DRAWERS()] },
    safe: { placement: ['wall', 'corner'], underWindow: true, rank: 3, zones: [Z('front', 500, 600)] },
    printer: { placement: ['ontop'], underWindow: true, rank: 3, zones: [] },
    'closet-island': { placement: ['free'], underWindow: true, rank: 2, zones: [Z('around', 600, 800)] },
    'small-table': { placement: ['free', 'near'], underWindow: true, rank: 3, zones: [Z('around', 300, 450)] },
    'drying-rack': { placement: ['wall', 'free'], byForm: { wall: ['wallMount'] }, underWindow: true, rank: 3, zones: [Z('front', 500, 700)], formZones: { wall: [] }, anchorV: 'bottom', elevation: { min: 1600, max: 1900, ref: 'bottom' } },
    ac: { placement: ['wallMount'], underWindow: true, rank: 0, zones: [], anchorV: 'bottom' },
    speakers: { placement: ['near', 'wall'], underWindow: true, rank: 3, zones: [] },
    projector: { placement: ['ceiling'], underWindow: null, rank: 3, zones: [] },
    screen: { placement: ['wallMount'], underWindow: false, rank: 3, zones: [], anchorV: 'bottom', elevation: { min: 700, max: 1100, def: 900, ref: 'bottom' } },
    radiator: { placement: ['wallMount'], underWindow: true, rank: 0, zones: [], anchorV: 'bottom' },
    chandelier: { placement: ['ceiling'], underWindow: null, rank: 3, zones: [] },
    'ceiling-light': { placement: ['ceiling'], underWindow: null, rank: 3, zones: [] },
    track: { placement: ['ceiling'], underWindow: null, rank: 3, zones: [] },
    sconce: { placement: ['wallMount'], underWindow: false, rank: 3, zones: [], anchorV: 'center', elevation: { min: 1500, max: 1800, def: 1700, ref: 'bottom' } },
    picture: { placement: ['wallMount'], underWindow: false, rank: 3, zones: [], anchorV: 'center', elevation: { min: 1450, max: 1650, ref: 'center' } },
    curtain: { placement: ['wallMount'], underWindow: true, rank: 3, zones: [], anchorV: 'bottom', windowAttached: true },
    aquarium: { placement: ['wall', 'corner'], underWindow: false, rank: 1, zones: [Z('front', 600, 900)] },
  };
  const DEFAULT_BACK_GAP = [0, 50];

  /* Какой бок угловой формы прижимается ко второй стене угла: у L — правый (+x), у четверти круга — левый (−x) */
  const CORNER_SIDE = { L: '+x', quarter: '-x' };

  /* Группы (ТЗ §14.4): якорь и шаблон членов. Члены группы не мешают зонам своего якоря. */
  const GROUPS = {
    sleep: { name: 'Спальное место', anchor: ['bed', 'kids-bed'], members: { nightstand: { max: 2, rel: 'beside', gap: [0, 100], align: 'back', symmetric: true }, bench: { max: 1, rel: 'in_front_of', range: [0, 150] }, rug: { max: 1, rel: 'under' } } },
    lounge: { name: 'Зона отдыха', anchor: ['sofa'], members: { 'coffee-table': { max: 1, rel: 'in_front_of', range: [350, 500] }, armchair: { max: 2, rel: 'beside', gap: [200, 900], facing: 'coffee-table' }, pouf: { max: 2, rel: 'near', range: [0, 600] }, 'floor-lamp': { max: 1, rel: 'beside', gap: [0, 300] }, rug: { max: 1, rel: 'under' } } },
    media: { name: 'Медиа', anchor: ['tv-stand', 'tv'], members: { tv: { max: 1, rel: 'on_top_of' } } },
    dining: { name: 'Обеденная', anchor: ['table'], members: { chair: { max: 12, rel: 'around' }, bench: { max: 2, rel: 'beside', gap: [0, 300] }, sideboard: { max: 1, rel: 'near', range: [0, 2500] } } },
    work: { name: 'Рабочее место', anchor: ['desk'], members: { 'office-chair': { max: 1, rel: 'in_front_of', range: [0, 300] }, chair: { max: 1, rel: 'in_front_of', range: [0, 300] }, pedestal: { max: 1, rel: 'beside', gap: [0, 100] }, shelving: { max: 1, rel: 'near', range: [0, 1500] }, bookcase: { max: 1, rel: 'near', range: [0, 1500] } } },
    entry: { name: 'Прихожая', anchor: ['door'], members: { 'shoe-rack': { rel: 'near_entrance', range: [0, 1500] }, 'coat-rack': { rel: 'near_entrance', range: [0, 1500] }, bench: { rel: 'near_entrance', range: [0, 1500] }, mirror: { rel: 'near_entrance', range: [0, 1500] }, console: { rel: 'near_entrance', range: [0, 1500] }, wardrobe: { rel: 'near_entrance', range: [0, 1500] } } },
    storage: { name: 'Хранение', anchor: ['wardrobe'], members: {} },
    bar: { name: 'Барная стойка', anchor: ['bar-counter', 'island'], members: { 'bar-stool': { max: 6, rel: 'in_front_of', range: [0, 300] } } },
  };
  /* Кто чей член группы: typeId члена → список типов якорей */
  const MEMBER_OF = {};
  for (const [gid, g] of Object.entries(GROUPS)) for (const m of Object.keys(g.members)) (MEMBER_OF[m] = MEMBER_OF[m] || []).push(...g.anchor.map(a => ({ group: gid, anchor: a })));

  /* Кто может стоять в жёсткой зоне якоря (гость зоны): тумбы у кровати, стулья у стола и т. п. (ТЗ §14.3) */
  const ZONE_GUESTS = {
    // тумбы стоят у изголовья, до начала боковых зон кровати (from = 450), поэтому гостями кровати не являются
    table: ['chair', 'bench', 'bar-stool'],
    'meeting-table': ['chair', 'office-chair'], desk: ['chair', 'office-chair', 'pedestal'], 'bar-counter': ['bar-stool'],
    island: ['bar-stool', 'chair'], 'dressing-table': ['pouf', 'chair', 'bench'], 'changing-table': [], 'coffee-table': ['pouf'],
  };
  /* Кто не мешает рекомендуемой (мягкой) глубине зоны, хотя жёсткую соблюдает: журнальный столик у дивана (ТЗ §14.3) */
  const SOFT_GUESTS = { sofa: ['coffee-table', 'pouf', 'armchair'], armchair: ['coffee-table', 'pouf'], bed: ['nightstand', 'bench', 'rug'], 'kids-bed': ['nightstand', 'rug'] };

  /* Программа комнаты по назначению (ТЗ §14.5): must — обязательно, usual — обычно, optional — по желанию */
  const PROGRAMS = {
    living: { must: ['sofa'], usual: ['coffee-table', 'tv-stand', 'tv', 'armchair', 'shelving'], optional: ['bookcase', 'console', 'pouf', 'sideboard', 'small-table'] },
    bedroom: { must: ['bed'], usual: ['nightstand', 'wardrobe'], optional: ['dresser', 'dressing-table', 'armchair', 'bench', 'tv', 'desk'] },
    kids: { must: ['kids-bed'], usual: ['desk', 'chair', 'wardrobe', 'shelving'], optional: ['beanbag', 'dresser', 'toy-house', 'changing-table'] },
    kitchen: { must: [], usual: ['table', 'chair'], optional: ['sideboard', 'bar-stool'] },
    dining: { must: ['table', 'chair'], usual: ['sideboard'], optional: ['showcase', 'console'] },
    office: { must: ['desk', 'office-chair'], usual: ['shelving', 'pedestal'], optional: ['bookcase', 'armchair', 'console', 'meeting-table'] },
    bath: { must: [], usual: [], optional: ['tall-cabinet', 'wall-shelf'] },
    toilet: { must: [], usual: [], optional: ['wall-shelf'] },
    hall: { must: [], usual: ['shoe-rack', 'coat-rack'], optional: ['bench', 'console', 'wardrobe', 'wall-shelf'] },
    closet: { must: [], usual: ['wardrobe', 'shelving'], optional: ['dresser', 'bench', 'closet-island'] },
    balcony: { must: [], usual: [], optional: ['small-table', 'armchair', 'chair'] },
  };

  /* Словарь отношений (ТЗ §18.6). args — какие поля нужны; everything else — приоритет must/should/nice */
  const RELATIONS = {
    against_wall: { args: ['a', 'wall'] }, in_corner: { args: ['a'] }, centered_on_wall: { args: ['a', 'wall'] },
    near_window: { args: ['a'], dist: 1500 }, away_from_window: { args: ['a'], dist: 1500 }, under_window: { args: ['a'] },
    near_entrance: { args: ['a'], dist: 1500 }, away_from_entrance: { args: ['a'], dist: 2000 },
    facing: { args: ['a', 'b'], maxAngle: 20 }, opposite: { args: ['a', 'b'] }, in_front_of: { args: ['a', 'b'] },
    beside: { args: ['a', 'b'] }, around: { args: ['a', 'b'] }, aligned: { args: ['a', 'b'] },
    parallel: { args: ['a', 'b'] }, perpendicular: { args: ['a', 'b'] }, same_wall: { args: ['a', 'b'] },
    distance: { args: ['a', 'b', 'range'] }, on_top_of: { args: ['a', 'b'] }, under: { args: ['a', 'b'] },
    in_region: { args: ['a', 'region'] }, keep_clear: { args: ['rect'] }, symmetric: { args: ['a', 'b', 'c'] },
  };
  const PRIORITY_WEIGHT = { must: 3, should: 2, nice: 1 };

  function spec(typeId) { return P[typeId] || { placement: ['free'], rank: 3, zones: [] }; }
  /* Способы постановки конкретной формы */
  function placementsOf(typeId, formId) { const s = spec(typeId); return (s.byForm && s.byForm[formId]) || s.placement; }
  function backGapOf(typeId) { return spec(typeId).backGap || DEFAULT_BACK_GAP; }
  function underWindowOf(typeId, formId) { const s = spec(typeId); if (s.byFormUnderWindow && s.byFormUnderWindow[formId] !== undefined) return s.byFormUnderWindow[formId]; return s.underWindow; }
  function rankOf(typeId) { return spec(typeId).rank; }
  /* Зоны обслуживания предмета с учётом формы и полей товара (doorType, serviceDepth). Возвращает список
     {side, hard, soft, oneOf?, from?, seats?, passBehind?} в мм, уже без «по фасаду». */
  function zonesOf(item, product) {
    const s = spec(item.typeId); const t = CT.TYPE.get(item.typeId);
    const fo = t ? t.forms.find(f => f.id === item.formId) || t.forms[0] : null;
    let list = (s.formZones && s.formZones[item.formId]) || s.zones || [];
    const depth = item.dims ? (item.dims.D ?? item.dims.L ?? item.dims.DIA ?? item.dims.W ?? 500) : 500;
    const out = [];
    for (const z of list) {
      if (z.door) {
        const kind = (product && product.doorType) || (item.doorType) || z.defaultDoor || 'hinged';
        const v = DOOR_ZONES[kind];
        if (v === null) continue;
        if (v === 'depth') out.push({ side: 'front', hard: depth + DRAWERS_ADD[0], soft: depth + DRAWERS_ADD[1] });
        else out.push({ side: 'front', hard: v[0], soft: v[1] });
      } else if (z.drawers) out.push({ side: 'front', hard: Math.min(depth, 600) + DRAWERS_ADD[0], soft: Math.min(depth, 600) + DRAWERS_ADD[1] });
      else out.push(Object.assign({}, z));
    }
    if (s.bedZones && fo) {
      const W = item.dims.W || fo.typical.W || 900;
      if (item.formId === 'crib') { /* зона кроватки — formZones */ }
      else if (W >= 1200) out.push(...BEDSIDE(600, 600, 450), { side: 'front', hard: 0, soft: 600 });
      else out.push(...BEDSIDE(500, 700, 0));
    }
    if (s.lateral) out.push({ side: 'lateral', hard: s.lateral[0], soft: s.lateral[1] });
    const sd = product && product.serviceDepth;
    if (sd > 0) for (const z of out) if (z.side === 'front') { z.hard = Math.max(z.hard, sd); z.soft = Math.max(z.soft, sd); }
    return out;
  }
  return {
    VERSION, P, DOOR_ZONES, CORNER_SIDE, GROUPS, MEMBER_OF, ZONE_GUESTS, SOFT_GUESTS, PROGRAMS, RELATIONS, PRIORITY_WEIGHT,
    spec, placementsOf, backGapOf, underWindowOf, rankOf, zonesOf,
  };
});
