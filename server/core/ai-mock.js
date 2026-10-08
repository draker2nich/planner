'use strict';
/* Заглушка языковой модели для разработки и тестов (AI_MOCK=1): отвечает в том же формате, что и настоящая модель,
   но по простым правилам и без обращения к сети. Вкуса и замысла у неё нет — она нужна, чтобы проверить весь путь
   «мастер → генерация → проверка расстановки → экран результата» без ключа и без расходов. */
const T = require('../../public/shared/catalog-types.js');

function taste(inp) {
  const text = String(inp.text || '').toLowerCase().replace(/ё/g, 'е');
  const styles = [];
  if (inp.prefs && inp.prefs.style) styles.push(inp.prefs.style);
  for (const s of T.STYLES) if (text.includes(s.replace(/ё/g, 'е')) && !styles.includes(s)) styles.push(s);
  for (const s of ['скандинавский', 'современный']) if (styles.length < 2 && !styles.includes(s)) styles.push(s);
  const pal = inp.prefs && inp.prefs.palette;
  const dark = pal === 'тёмная' || text.includes('темн'), cool = pal === 'холодная' || text.includes('холодн');
  const colors = dark ? ['серый', 'чёрный', 'коричневый'] : cool ? ['белый', 'серый', 'синий'] : ['белый', 'бежевый', 'натуральное дерево'];
  const avoidColors = T.COLORS.map(c => c.name).filter(c => text.includes('без ' + c.replace(/ё/g, 'е').slice(0, -2)) && !colors.includes(c)).slice(0, 3);
  const liked = new Set((inp.photos || []).flatMap(p => p.likes || []));
  return {
    styles: styles.slice(0, 3), colors, avoidColors, materials: ['дерево', 'ткань'],
    tone: dark ? 'dark' : 'light', temp: cool ? 'cool' : 'warm', contrast: pal === 'контрастная',
    walls: liked.has('walls') ? 'Спокойные светлые стены, как на фото' : '', floor: liked.has('floor') ? 'Тёплый деревянный пол' : '',
    ceiling: '', lighting: liked.has('lighting') ? 'Мягкий рассеянный свет' : '', decor: '', layout: liked.has('layout') ? 'Свободный центр комнаты' : '',
    furniture: (inp.types || []).slice(0, 2).map(t => ({ type: t, note: 'Простая форма, без лишнего декора' })),
    summary: 'Заглушка модели: спокойный интерьер в выбранном стиле.',
  };
}

function concept(inp) {
  const fin = inp.finishes || {};
  const mk = (i) => ({
    title: i ? 'Тёплый контраст' : 'Светлый и спокойный',
    note: i ? 'Заглушка модели: более выразительная мебель и тёмный пол.' : 'Заглушка модели: светлая мебель и дерево.',
    layoutIdea: i ? 'Крупная мебель — вдоль стен, центр свободен.' : 'Сохранить нынешние места, если они удобны.',
    walls: fin.walls === 'ai' ? (i ? 'texture:paint-cool' : '#efe8dc') : 'keep',
    floor: fin.floor === 'ai' ? (i ? 'texture:wood-dark' : 'texture:wood-oak') : 'keep',
    ceiling: fin.ceiling === 'ai' ? (i ? '#f1efe9' : '#ffffff') : 'keep',
    picks: (inp.groups || []).map(g => ({ group: g.group, products: i && g.products.length > 1 ? [...g.products.slice(1, 3), g.products[0]] : g.products.slice(0, 3) })),
  });
  return { concepts: [mk(0), mk(1)] };
}

const SEATS = ['chair', 'bar-stool', 'office-chair'], TABLES = ['table', 'desk', 'meeting-table', 'bar-counter', 'island', 'dressing-table'];
const blank = (id, mode, extra) => Object.assign({ id, mode, wall: '', offset: 0, gap: 0, ref: '', side: 'none', shift: 0, face: 'auto', x: 0, y: 0, elev: -1 }, extra);
function layout(inp) {
  const items = inp.items || [], walls = (inp.room && inp.room.walls) || [];
  const movable = items.filter(it => !it.fixed);
  /* первый вариант повторяет нынешние места — так проверяется путь «оставить как есть» */
  if (inp.variant === 0 && !inp.retry && inp.mode !== 'again') return { placements: movable.map(it => it.at ? blank(it.id, it.at.mode, { wall: it.at.wall || '', offset: it.at.offset || 0, gap: it.at.gap || 0, x: it.at.x || 0, y: it.at.y || 0, face: it.at.face || 'auto', elev: it.at.elev != null ? it.at.elev : -1 }) : blank(it.id, 'center', { ref: 'room' })) };
  const first = (types) => items.find(it => types.includes(it.type));
  const sofa = first(['sofa']), bed = first(['bed', 'kids-bed']), table = first(TABLES);
  const order = [...walls].sort((a, b) => b.len - a.len);
  const cursor = new Map(order.map(w => [w.id, 0])), mcursor = new Map(order.map(w => [w.id, 0]));
  /* занятые неподвижной мебелью участки стен заглушка не знает — пересечения исправит редактор */
  const fitOn = (cur, w, width, high, floor) => {
    let s = cur.get(w.id);
    for (let guard = 0; guard < 40; guard++) {
      const hit = w.openings.find(o => (floor ? (o.kind !== 'window' || high > (o.sill || 0)) : true) && s < o.span[1] + 100 && o.span[0] - 100 < s + width);
      if (!hit) break; s = hit.span[1] + 100;
    }
    if (s + width > w.len) return null;
    cur.set(w.id, s + width + 100); return s;
  };
  const out = []; let seat = 0; const sides = ['front', 'back', 'left', 'right'];
  const big = movable.filter(it => it.kind === 'floor').sort((a, b) => b.w * b.d - a.w * a.d);
  for (const it of big) {
    if (inp.retry && it.problem) { out.push(blank(it.id, 'center', { ref: 'room' })); continue; }
    if (SEATS.includes(it.type) && table && table.id !== it.id) { out.push(blank(it.id, 'beside', { ref: table.id, side: sides[seat % 4], shift: seat >= 4 ? 500 : 0, gap: 50 })); seat++; continue; }
    if (it.type === 'coffee-table' && sofa) { out.push(blank(it.id, 'beside', { ref: sofa.id, side: 'front', gap: 400 })); continue; }
    if (it.type === 'nightstand' && bed) { out.push(blank(it.id, 'beside', { ref: bed.id, side: out.some(p => p.ref === bed.id && p.side === 'left') ? 'right' : 'left', gap: 50 })); continue; }
    let done = false;
    for (const w of order) { const s = fitOn(cursor, w, it.w, it.h, true); if (s != null) { out.push(blank(it.id, 'wall', { wall: w.id, offset: s })); done = true; break; } }
    if (!done) out.push(blank(it.id, 'center', { ref: 'room' }));
  }
  for (const it of movable) {
    if (it.kind === 'floor') continue;
    if (it.kind === 'rug') out.push(blank(it.id, 'center', { ref: (sofa || bed || table || { id: 'room' }).id }));
    else if (it.kind === 'ceiling') out.push(blank(it.id, 'center', { ref: 'room' }));
    else if (it.type === 'tv' && (sofa || bed)) out.push(blank(it.id, 'mount', { ref: (sofa || bed).id, side: 'front' }));
    else {
      let done = false;
      for (const w of order) { const s = fitOn(mcursor, w, it.w, it.h, false); if (s != null) { out.push(blank(it.id, 'mount', { wall: w.id, offset: s })); done = true; break; } }
      if (!done && order[0]) out.push(blank(it.id, 'mount', { wall: order[0].id, offset: 0 }));
    }
  }
  return { placements: out };
}

/* mock(name, input) для makeAi */
function mock(name, input) {
  if (name === 'taste') return taste(input || {});
  if (name === 'concept') return concept(input || {});
  if (name === 'layout') return layout(input || {});
  throw new Error('Неизвестный шаг: ' + name);
}
module.exports = { mock };
