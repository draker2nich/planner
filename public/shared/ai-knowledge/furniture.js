/* =====================================================================
   Что за предмет: функции, категория прав, добавление ИИ, вес цены, основания (ТЗ §14.1, прил. А).
   Как предмет ставится — placement.js; что проверяется — ai-rules.js.
   Браузер: глобальный AIFurniture. Node: require('./furniture.js').
   ===================================================================== */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  // eslint-disable-next-line no-undef
  const api = factory(isNode ? require('../catalog-types.js') : { TYPES, TYPE });
  if (isNode) module.exports = api; else root.AIFurniture = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CT) {
  'use strict';
  const VERSION = 'furniture-1';
  /* category: normal — все права; infra — только keep; utility — keep / replace (коммуникации); fixed — keep / replace (потолок, шторы) */
  const CATEGORY = {
    infra: ['radiator', 'towel-rail', 'boiler', 'ac'],
    utility: ['sink', 'toilet', 'bidet', 'bathtub', 'shower', 'washbasin', 'vanity', 'washer', 'dryer', 'dishwasher', 'stove', 'hood', 'kitchen-base', 'kitchen-wall'],
    fixed: ['chandelier', 'ceiling-light', 'track', 'projector', 'curtain'],
  };
  const FUNCTIONS = {
    seating: ['sofa', 'armchair', 'pouf', 'beanbag', 'bench', 'chair', 'office-chair', 'bar-stool', 'coffee-table', 'small-table'],
    sleeping: ['bed', 'kids-bed'],
    storage: ['shelving', 'bookcase', 'showcase', 'wardrobe', 'closet-system', 'dresser', 'nightstand', 'sideboard', 'tall-cabinet', 'wall-shelf', 'shoe-rack', 'coat-rack', 'pedestal', 'closet-island', 'tv-stand', 'console', 'vanity', 'dressing-table'],
    work: ['desk', 'office-chair', 'pedestal', 'meeting-table', 'printer', 'safe'],
    dining: ['table', 'chair', 'sideboard', 'bar-counter', 'bar-stool'],
    media: ['tv', 'tv-stand', 'speakers', 'projector', 'screen'],
    cooking: ['kitchen-base', 'kitchen-wall', 'island', 'sink', 'stove', 'oven', 'hood', 'fridge', 'dishwasher', 'microwave'],
    hygiene: ['bathtub', 'shower', 'washbasin', 'vanity', 'toilet', 'bidet', 'washer', 'dryer', 'drying-rack'],
    entry: ['shoe-rack', 'coat-rack', 'console', 'bench', 'mirror'],
    display: ['showcase', 'picture', 'aquarium', 'plant', 'fireplace', 'mirror', 'rug', 'curtain'],
    play: ['toy-house', 'beanbag', 'kids-bed', 'changing-table'],
    lighting: ['floor-lamp', 'table-lamp', 'chandelier', 'ceiling-light', 'track', 'sconce'],
    climate: ['radiator', 'towel-rail', 'boiler', 'ac'],
  };
  /* Сколько предметов типа ИИ может добавить сам (0 — не добавляет). ТЗ §11.6, прил. А */
  const AI_ADD = { sofa: 2, armchair: 4, pouf: 4, beanbag: 2, 'coffee-table': 2, 'tv-stand': 1, tv: 1, shelving: 4, bookcase: 3, showcase: 2, console: 2, bed: 1, nightstand: 2, dresser: 2, wardrobe: 3, 'dressing-table': 1, bench: 2, 'kids-bed': 3, desk: 2, chair: 12, table: 1, sideboard: 2, 'tall-cabinet': 2, 'wall-shelf': 4, 'coat-rack': 1, 'shoe-rack': 2, 'office-chair': 2, pedestal: 2, 'small-table': 2, 'bar-stool': 6 };
  const PRICE_WEIGHT = { sofa: 10, bed: 10, 'kids-bed': 7, wardrobe: 8, 'closet-system': 8, 'kitchen-base': 10, island: 7, table: 6, 'meeting-table': 6, 'bar-counter': 5, desk: 5, dresser: 5, sideboard: 5, tv: 6, armchair: 4, bookcase: 4, showcase: 4, fridge: 6, bathtub: 6, shower: 6, washer: 5, dishwasher: 4, stove: 5, oven: 4, 'tv-stand': 3, shelving: 3, 'dressing-table': 3, 'closet-island': 4, 'tall-cabinet': 2, 'coffee-table': 2, console: 2, bench: 2, 'office-chair': 2, beanbag: 2, 'shoe-rack': 2, 'changing-table': 3, vanity: 4, washbasin: 3, toilet: 3, bidet: 2, fireplace: 5, aquarium: 3, 'kitchen-wall': 5, dryer: 4, hood: 2, sink: 2, rug: 2, speakers: 2, screen: 2, projector: 2, 'toy-house': 2 };
  /* Основания для предметов «на основании» (прил. А.5) */
  const BASES = {
    'table-lamp': ['nightstand', 'desk', 'dresser', 'console', 'coffee-table', 'sideboard', 'tv-stand', 'dressing-table', 'small-table', 'pedestal'],
    tv: ['tv-stand', 'dresser', 'sideboard', 'console'],
    sink: ['kitchen-base', 'island'], oven: ['kitchen-base', 'island'], stove: ['kitchen-base', 'island'], microwave: ['kitchen-base', 'island', 'bar-counter'],
    washbasin: ['vanity'], dryer: ['washer'], printer: ['desk', 'pedestal', 'console', 'sideboard'],
  };
  /* Ниже этой высоты предмет не препятствие для зон и проходов (ТЗ §14.1) */
  const SOLID_HEIGHT = { rug: 20 };
  const MAX_PER_ROOM_DEFAULT = 0;

  const categoryOf = (typeId) => Object.keys(CATEGORY).find(k => CATEGORY[k].includes(typeId)) || 'normal';
  const functionsOf = (typeId) => Object.keys(FUNCTIONS).filter(k => FUNCTIONS[k].includes(typeId));
  const TABLE = new Map(CT.TYPES.map(t => [t.id, {
    id: t.id, name: t.name,
    category: categoryOf(t.id),
    functions: functionsOf(t.id),
    rooms: t.cats.filter(c => !['tech', 'light', 'decor'].includes(c)),
    aiAdd: AI_ADD[t.id] || MAX_PER_ROOM_DEFAULT,
    priceWeight: categoryOf(t.id) === 'infra' ? 0 : (PRICE_WEIGHT[t.id] || 1),
    bases: BASES[t.id] || null,
    solidHeight: SOLID_HEIGHT[t.id] || 0,
    isBase: !!t.base,
  }]));
  /* Допустимые права для предмета (ТЗ §11.3). Пустышка инженерного типа — существующее оборудование: только keep. */
  function allowedPolicies(typeId, isPlaceholder) {
    const cat = categoryOf(typeId);
    if (cat === 'infra') return ['keep'];
    if (isPlaceholder) return cat === 'normal' ? ['replace', 'free'] : ['replace'];
    if (cat === 'utility' || cat === 'fixed') return ['keep', 'replace'];
    return ['keep', 'move', 'replace', 'free'];
  }
  /* Приведение права к ближайшему допустимому (ТЗ §11.3) */
  function normalizePolicy(typeId, isPlaceholder, policy) {
    const allowed = allowedPolicies(typeId, isPlaceholder);
    if (allowed.includes(policy)) return policy;
    const cat = categoryOf(typeId);
    if (cat === 'infra') return 'keep';
    if (isPlaceholder) return (policy === 'move' || policy === 'free') && allowed.includes('free') ? 'free' : 'replace';
    if (cat === 'utility' || cat === 'fixed') return policy === 'free' ? 'replace' : 'keep';
    return 'keep';
  }
  return { VERSION, CATEGORY, FUNCTIONS, TABLE, get: (id) => TABLE.get(id), categoryOf, functionsOf, allowedPolicies, normalizePolicy };
});
