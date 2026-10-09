/* Сопоставление произвольного товара с категориями и формами платформы (public/shared/catalog-types.js).
   Чистые функции: на входе название, тип источника и габарит модели, на выходе typeId, formId, размеры в мм
   и атрибуты для ИИ‑подбора. Всё, что не удалось уверенно сопоставить, пропускается с причиной. */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const T = require('../../../public/shared/catalog-types.js');

/* ---------- тип ---------- */

/* Правила по «главной» части названия (до запятой, «with», «for»): частное раньше общего. skip — заведомо не мебель. */
const NAME_RULES = [
  { skip: 'аксессуар', re: /\b(pillow|cushion|slip ?cover|cover|pad|protector|mattress|topper|headboard|bed ?rail|bed ?skirt|sheet|duvet|comforter|blanket|throw|runner cloth|table ?cloth|placemat|napkin|lamp ?shade|shade|bulb|bracket|knob|handle|hook|hardware|caster|leg|legs|riser|tray|coaster|basket|bin|box|organizer insert|hanger|curtain|drape|rod|valance|clock|vase|candle|frame set|sticker|decal)s?$/ },
  { skip: 'для животных', re: /\b(dog|cat|pet)\b/ },

  { type: 'office-chair', re: /\b(office|desk|task|executive|gaming|computer|swivel|drafting) (chair|stool)\b/ },
  { type: 'bar-stool', re: /\b(bar ?stools?|counter[- ]?(height )?(stool|chair)s?|pub (stool|chair)s?)\b/ },
  { type: 'beanbag', re: /\bbean ?bag\b/ },
  { type: 'nightstand', re: /\b(night ?stand|bedside (table|cabinet))s?\b/ },
  { type: 'coffee-table', re: /\b(coffee|cocktail) table\b/ },
  { type: 'console', re: /\b(console|sofa|entryway|entry|hall(way)?|foyer) table\b/ },
  { type: 'small-table', re: /\b(side|end|accent|nesting|bistro|chair ?side|tray|c[- ]shaped?|drink|snack|lamp) tables?\b|\bplant stands?\b/ },
  { type: 'dressing-table', re: /\b(vanity|dressing|makeup) (table|desk|set)\b/ },
  { type: 'meeting-table', re: /\b(conference|meeting) table\b/ },
  { type: 'bar-counter', re: /\b(bar|pub|counter[- ]height) table\b/ },
  { type: 'island', re: /\bkitchen (island|cart)\b/ },
  { type: 'tv-stand', re: /\b(tv|television|media) (stand|console|cabinet|unit|center)\b|\bentertainment (center|console)\b/ },
  { type: 'sideboard', re: /\b(sideboard|buffet|credenza)\b/ },
  { type: 'showcase', re: /\b(curio|china|display) cabinet\b/ },
  { type: 'shoe-rack', re: /\bshoe (rack|cabinet|storage|shelf|organizer)\b/ },
  { type: 'coat-rack', re: /\b(coat|hat) (rack|stand|tree)\b|\bhall tree\b/ },
  { type: 'pedestal', re: /\b(file|filing) cabinet\b|\bmobile pedestal\b/ },
  { type: 'vanity', re: /\bbath(room)? vanity\b/ },
  { type: 'wall-shelf', re: /\b(floating|wall([- ]mounted)?|hanging) (shelf|shelves|ledge)\b/ },
  { type: 'bookcase', re: /\b(bookcase|book ?shel(f|ves)|bookshelves)\b/ },
  { type: 'shelving', re: /\b(shelving( unit)?|shelf unit|etagere|étagère|ladder shelf|storage (shelf|shelves|rack)|cube (organizer|storage)|shel(f|ves))\b/ },
  { type: 'wardrobe', re: /\b(wardrobe|armoire)\b/ },
  { type: 'dresser', re: /\b(dresser|chest of drawers|drawer chest|\d[- ]drawer chest)\b/ },
  { type: 'sofa', re: /\b(sofa|couch|loveseat|love seat|sectional|settee|futon|sleeper)\b/ },
  { type: 'bench', re: /\bbench\b/ },
  { type: 'pouf', re: /\b(ottoman|pouf|pouffe|foot ?stool|foot ?rest)\b/ },
  { type: 'armchair', re: /\b(arm ?chair|accent chair|club chair|lounge chair|recliner|wing ?back|glider|rocker|rocking chair|chaise|barrel chair|slipper chair|papasan)\b/ },
  { type: 'chair', re: /\bchairs?\b/ },
  { type: 'bar-stool', re: /\bstools?\b/, stool: true },
  { type: 'kids-bed', re: /\b(crib|bunk bed|toddler bed)\b/ },
  { type: 'bed', re: /\b(bed|bed ?frame|platform bed|day ?bed)\b/ },
  { type: 'desk', re: /\b(desk|writing table|computer table|workstation)\b/ },
  { type: 'table', re: /\b(dining|kitchen|dinette|breakfast) table\b/ },
  { type: 'floor-lamp', re: /\b(floor|standing|torchiere|tripod) (lamp|light)\b/ },
  { type: 'table-lamp', re: /\b(table|desk|bedside|accent|task|buffet) (lamp|light)\b/ },
  { type: 'sconce', re: /\b(sconce|wall (lamp|light|lantern)|vanity light)\b/ },
  { type: 'chandelier', re: /\b(chandelier|pendant|hanging (lamp|light))\b/ },
  { type: 'ceiling-light', re: /\b(flush ?mount|semi[- ]flush|ceiling (lamp|light|fixture))\b/ },
  { type: 'rug', re: /\b(rug|carpet|runner|door ?mat)\b/ },
  { type: 'mirror', re: /\bmirror\b/ },
  { type: 'picture', re: /\b(wall art|canvas( print)?|painting|art print|framed (art|print)|poster)\b/ },
  { type: 'plant', re: /\b(artificial|faux|fake|potted) (plant|tree|fern|palm|succulent)\b|\b(planter|plant pot|flower ?pot)\b/ },
  { type: 'fireplace', re: /\bfireplace\b/ },
  { type: 'table', re: /\btable\b/ },
  { type: 'sideboard', re: /\b(storage|accent) cabinet\b|\bcabinet\b/, cabinet: true },
];

/* Если по названию тип не определился — по типу товара из источника (Amazon product_type). */
const SOURCE_TYPE_DEFAULTS = [
  [/^SOFA$/, 'sofa'], [/^CHAIR$/, 'chair'], [/^(TABLE|DINING_TABLE)$/, 'table'], [/^(BED|BED_FRAME)$/, 'bed'], [/^(RUG|AREA_RUG)$/, 'rug'],
  [/^OTTOMAN$/, 'pouf'], [/^BENCH$/, 'bench'], [/^(STOOL_SEATING|STOOL)$/, 'bar-stool'], [/^DRESSER$/, 'dresser'], [/^DESK$/, 'desk'],
  [/MIRROR/, 'mirror'], [/^(SHELF|BOOKCASE)$/, 'shelving'], [/^CABINET$/, 'sideboard'], [/^NIGHTSTAND$/, 'nightstand'], [/^PLANTER$/, 'plant'],
  [/^WALL_ART$/, 'picture'], [/^(LAMP|LIGHT_FIXTURE|LIGHTING)$/, 'table-lamp'],
];
/* Типы источника, в которых мебель и предметы интерьера вообще встречаются; остальное (обувь, электроника…) отсекается сразу. */
const SOURCE_TYPE_ALLOWED = /SOFA|CHAIR|TABLE|BED|RUG|LAMP|LIGHT|OTTOMAN|BENCH|STOOL|DRESSER|DESK|MIRROR|SHELF|BOOKCASE|CABINET|NIGHTSTAND|PLANTER|WALL_ART|FURNITURE|HOME|STORAGE|FIREPLACE|WARDROBE|SEATING|DECOR/;

export function headOf(name) {
  return String(name || '').toLowerCase().replace(/amazon brand\s*[–-]\s*/g, '').split(/,|\s[–-]\s|\swith\s|\sfor\s|\sw\/|\(|\sin\s|\|/)[0].trim();
}

/** → { typeId } | { skip: причина } */
export function matchType({ name, sourceType, sizeMm }) {
  const st = String(sourceType || '').toUpperCase();
  if (st && !SOURCE_TYPE_ALLOWED.test(st)) return { skip: 'не мебель: ' + st };
  const head = headOf(name);
  for (const r of NAME_RULES) {
    if (!r.re.test(head)) continue;
    if (r.skip) return { skip: r.skip };
    let typeId = r.type;
    if (r.stool && sizeMm && sizeMm.y < 550) typeId = 'pouf'; // низкий табурет — к пуфам
    if (r.cabinet && sizeMm && sizeMm.y >= 1500) typeId = 'wardrobe';
    if (typeId === 'chair' && sizeMm && sizeMm.x >= 680) typeId = 'armchair';
    return { typeId };
  }
  for (const [re, typeId] of SOURCE_TYPE_DEFAULTS) {
    if (!re.test(st)) continue;
    if (typeId === 'table-lamp' && sizeMm && sizeMm.y >= 1000) return { typeId: 'floor-lamp' };
    if (typeId === 'chair' && sizeMm && sizeMm.x >= 680) return { typeId: 'armchair' };
    return { typeId };
  }
  return { skip: 'тип не распознан' };
}

/* ---------- форма и размеры ---------- */

const ROUND = /\b(round|circular|circle|drum)\b/, OVAL = /\b(oval|ellipt)/;
const LIM = { min: 10, max: 20000 };
const clampDim = (v) => Math.min(LIM.max, Math.max(LIM.min, Math.round(v)));

/**
 * Подбирает форму типа под габарит модели (мм: x — ширина, y — высота, z — глубина).
 * → { formId, dims, target: {x,y,z}, rotateY } | { skip }
 * target — габарит, к которому модель приводится масштабом (круг и квадрат требуют равных сторон, ковёр — минимальной толщины).
 */
export function chooseForm(typeId, sizeMm, name) {
  const t = T.TYPE.get(typeId);
  if (!t) return { skip: 'нет такого типа: ' + typeId };
  let { x, y, z } = sizeMm;
  if (![x, y, z].every((v) => Number.isFinite(v) && v > 0)) return { skip: 'нет габарита' };
  const text = String(name || '').toLowerCase();
  let rotateY = 0;
  const byFp = (fp) => t.forms.find((f) => f.fp === fp && !['L', 'U', 'quarter'].includes(f.fp));
  const wallForm = t.forms.find((f) => (f.mount || t.mount) === 'wall');
  const floorRect = t.forms.find((f) => f.fp === 'rect' && (f.mount || t.mount) !== 'wall');
  const circle = byFp('circle'), ellipse = byFp('ellipse'), square = byFp('square');
  const near = Math.min(x, z) / Math.max(x, z);
  let fo = null;

  if (typeId === 'bed') {
    fo = t.forms.find((f) => f.id === (x < 1050 ? 'single' : x < 1400 ? 'half' : x < 1700 ? 'double' : 'king'));
  } else if (typeId === 'kids-bed') {
    fo = t.forms.find((f) => f.id === (/crib/.test(text) ? 'crib' : /bunk/.test(text) ? 'bunk' : 'single'));
  } else if (typeId === 'mirror') {
    fo = t.forms.find((f) => f.id === (/\b(floor|full[- ]length|standing|leaning|cheval)\b/.test(text) || y >= 1400 ? 'floor' : 'wall'));
  } else if (typeId === 'coat-rack') {
    fo = t.forms.find((f) => f.id === (/\bwall\b/.test(text) || y < 700 ? 'wall' : 'round'));
  } else if (typeId === 'tv') {
    fo = t.forms.find((f) => f.id === 'wall');
  } else if (circle && (!floorRect && !wallForm || (ROUND.test(text) && near >= 0.8))) {
    fo = circle;
  } else if (ellipse && OVAL.test(text)) {
    fo = ellipse;
  } else if (square && near >= 0.97 && !floorRect) {
    fo = square;
  } else {
    fo = floorRect || wallForm || square || circle || t.forms[0];
  }
  if (!fo || ['L', 'U', 'quarter'].includes(fo.fp)) return { skip: 'нет подходящей формы' };

  if (['mirror', 'picture', 'wall-shelf'].includes(typeId)) {
    // плоские предметы: тонкая сторона — глубина. Модель, повёрнутую боком, разворачиваем; лежащую плашмя — пропускаем.
    if (y < Math.min(x, z) * 0.5 && typeId !== 'wall-shelf') return { skip: 'плоский предмет лежит плашмя' };
    if (x < z) { rotateY = 90; [x, z] = [z, x]; }
  }

  let tx = x, ty = y, tz = z;
  if (fo.fp === 'circle' || fo.fp === 'square') {
    if (Math.min(x, z) / Math.max(x, z) < 0.8) return { skip: fo.fp === 'circle' ? 'не круглый в плане' : 'не квадратный в плане' };
    tx = tz = Math.max(x, z);
  }
  tx = clampDim(tx); ty = clampDim(ty); tz = clampDim(tz);

  // правдоподобие: размеры не должны отличаться от типовых для формы в разы (иначе это аксессуар или ошибка масштаба)
  const typ = T.footprintExtents(fo.fp, fo.typical);
  const ratio = (a, b) => a / b;
  const fpOk = [ratio(tx, typ.w), ratio(tz, typ.d)].every((r) => r >= 0.2 && r <= 5);
  const hOk = t.layer === 'under' || (ratio(ty, fo.typical.H) >= 0.15 && ratio(ty, fo.typical.H) <= 4);
  if (!fpOk || !hOk) return { skip: 'размер не похож на тип' };

  const dims = { H: ty };
  for (const k of fo.dims) {
    if (k === 'W') dims.W = tx;
    else if (k === 'D' || k === 'L') dims[k] = tz;
    else if (k === 'DIA') dims.DIA = tx;
    else return { skip: 'форма с размером ' + k + ' не поддерживается' };
  }
  if (fo.typical.E != null) dims.E = fo.typical.E;
  return { formId: fo.id, dims, target: { x: tx, y: ty, z: tz }, rotateY };
}

/* ---------- атрибуты для ИИ‑подбора ---------- */

/* Значения справа — из словарей платформы (STYLES, COLORS, MATERIALS в public/shared/catalog-types.js);
   тест проверяет, что ни одно значение не выходит за словарь. */
const dict = (pairs) => {
  const fn = (text) => {
    const s = String(text || '').toLowerCase(), out = [];
    for (const [re, ru] of pairs) if (re.test(s) && !out.includes(ru)) out.push(ru);
    return out;
  };
  fn.values = [...new Set(pairs.map(([, ru]) => ru))];
  return fn;
};

export const colorsOf = dict([
  [/\b(white|ivory|snow|alabaster)\b/, 'белый'], [/\b(cream|beige|sand|linen|oatmeal|taupe|tan|khaki|natural|flax|wheat)\b/, 'бежевый'],
  [/\b(gr[ae]y|charcoal|slate|pewter|ash|graphite|smoke)\b/, 'серый'], [/\b(black|ebony|onyx|jet)\b/, 'чёрный'],
  [/\b(brown|walnut|espresso|chocolate|mocha|cognac|chestnut|coffee|mahogany|caramel|saddle|umber)\b/, 'коричневый'],
  [/\b(oak|maple|birch|pine|teak|acacia|bamboo|wood(en)?|honey|driftwood)\b/, 'натуральное дерево'],
  [/\b(blue|navy|indigo|denim|teal|aqua|turquoise|cobalt|azure|sapphire)\b/, 'синий'], [/\b(green|olive|sage|emerald|moss|forest|mint|hunter)\b/, 'зелёный'],
  [/\b(red|burgundy|crimson|wine|maroon|ruby|brick)\b/, 'красный'], [/\b(orange|rust|terracotta|copper|amber|burnt)\b/, 'оранжевый'],
  [/\b(yellow|mustard|gold(en)?|brass|lemon)\b/, 'жёлтый'], [/\b(pink|blush|rose|coral|salmon|fuchsia)\b/, 'розовый'],
  [/\b(purple|plum|violet|lavender|lilac|mauve|eggplant)\b/, 'фиолетовый'], [/\b(silver|chrome|nickel|steel|metallic)\b/, 'серебристый'],
  [/\b(clear|transparent|glass)\b/, 'прозрачный'], [/\b(multi(color(ed)?)?|pattern(ed)?|floral|striped?)\b/, 'разноцветный'],
]);

export const materialsOf = dict([
  [/\b(solid wood|wood(en)?|oak|walnut|pine|birch|maple|acacia|teak|mango|rubberwood|mahogany|beech|ash|hardwood)\b/, 'дерево'],
  [/\b(mdf|particle ?board|engineered wood|laminate|veneer|plywood|fiberboard)\b/, 'ЛДСП / МДФ'],
  [/\b(metal|steel|iron|alumin(um|ium)|brass|chrome|nickel)\b/, 'металл'], [/\b(glass|tempered)\b/, 'стекло'],
  [/\b(leather|leatherette|faux leather|bonded leather|pu\b|vinyl)\b/, 'кожа'], [/\bvelvet\b/, 'велюр'],
  [/\b(fabric|polyester|linen|cotton|chenille|tweed|upholster(ed|y)|microfiber|boucl[eé]|canvas|textile)\b/, 'ткань'],
  [/\b(wool|jute|sisal|polypropylene|viscose|shag)\b/, 'ковровое волокно'],
  [/\b(rattan|wicker|bamboo|cane|seagrass)\b/, 'ротанг'], [/\b(marble|stone|granite|concrete|ceramic|terrazzo|porcelain)\b/, 'камень'],
  [/\b(plastic|acrylic|resin|polycarbonate)\b/, 'пластик'],
]);

/* Словарь стилей совпадает с вариантами брифа ИИ‑дизайнера (PREFS.style в public/js/editor/brief.js) плюс несколько частых. */
export const stylesOf = dict([
  [/\b(modern|contemporary|mid[- ]century|transitional)\b/, 'современный'], [/\b(scandinavian|nordic|danish|scandi)\b/, 'скандинавский'],
  [/\b(industrial|loft|urban|factory)\b/, 'лофт'], [/\b(traditional|classic|victorian|antique|french|colonial|transitional|tufted|chesterfield)\b/, 'классика'],
  [/\b(minimal(ist)?|sleek|simple)\b/, 'минимализм'], [/\b(japandi|japanese|zen)\b/, 'японди'],
  [/\b(boho|bohemian|moroccan|eclectic|tribal|macram[eé])\b/, 'бохо'], [/\b(farmhouse|rustic|country|cottage|shabby)\b/, 'кантри'],
  [/\b(glam|hollywood|art deco|luxe)\b/, 'гламур'], [/\b(coastal|nautical|beach)\b/, 'прибрежный'], [/\b(retro|vintage)\b/, 'ретро'],
]);

export function cleanName(name, max = 120) {
  let s = String(name || '').replace(/\s+/g, ' ').replace(/^amazon brand\s*[–-]\s*/i, '').trim();
  const cut = s.split(/,| - | – |\(/)[0].trim();
  if (cut.length >= 12) s = cut;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

/* ---------- условная цена ----------
   В открытых наборах цен нет. Чтобы ИИ‑дизайнеру было из чего выбирать по бюджету, цена считается из типа, размера
   и «ценового уровня» бренда; для одного и того же товара она всегда одинакова. Это не реальные цены. */
/* Базовые цены — в валюте платформы (BYN, см. PLATFORM_CURRENCY в public/shared/catalog-types.js) */
const BASE_BYN = { sofa: 2300, armchair: 960, pouf: 280, beanbag: 220, 'coffee-table': 520, 'tv-stand': 700, shelving: 440, bookcase: 630, showcase: 1040,
  console: 560, fireplace: 1670, rug: 410, 'floor-lamp': 330, 'table-lamp': 170, plant: 130, bed: 1550, nightstand: 310, dresser: 810, wardrobe: 1780,
  'dressing-table': 590, bench: 410, mirror: 260, 'kids-bed': 890, desk: 670, chair: 260, table: 1110, 'bar-counter': 960, 'bar-stool': 240,
  sideboard: 1070, 'shoe-rack': 280, 'coat-rack': 190, 'meeting-table': 2040, 'office-chair': 520, pedestal: 330, 'small-table': 240, chandelier: 440,
  'ceiling-light': 190, sconce: 130, picture: 110, 'wall-shelf': 90, island: 1260, vanity: 780 };

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export function syntheticPrice({ id, typeId, formId, dims, brand }) {
  const t = T.TYPE.get(typeId), fo = T.formOf(t, formId);
  const a = T.footprintExtents(fo.fp, dims), b = T.footprintExtents(fo.fp, fo.typical);
  const size = Math.min(1.8, Math.max(0.6, Math.sqrt((a.w * a.d) / (b.w * b.d))));
  const tier = [0.65, 1, 1, 1.6][hash('tier:' + String(brand || id)) % 4];
  const jitter = 0.85 + (hash('price:' + id) % 3001) / 10000; // 0.85…1.15
  const raw = (BASE_BYN[typeId] || 370) * size * tier * jitter;
  return Math.max(19, Math.round(raw / 10) * 10 - 1);
}
