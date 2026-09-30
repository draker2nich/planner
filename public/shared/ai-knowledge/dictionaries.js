/* =====================================================================
   Справочники для ИИ-дизайнера: стили, цветовые группы, материалы, назначения комнат.
   Общие для редактора, админки, сервера и промптов (ТЗ §17.2). id — по-английски, name — для пользователя.
   Браузер: глобальный AIDict. Node: require('./dictionaries.js').
   ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AIDict = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 'dict-1';
  const STYLES = [
    { id: 'modern', name: 'Современный' }, { id: 'scandi', name: 'Скандинавский' }, { id: 'minimal', name: 'Минимализм' },
    { id: 'loft', name: 'Лофт' }, { id: 'classic', name: 'Классика' }, { id: 'neoclassic', name: 'Неоклассика' },
    { id: 'japandi', name: 'Японди' }, { id: 'boho', name: 'Бохо' }, { id: 'provence', name: 'Прованс' },
    { id: 'eco', name: 'Эко' }, { id: 'artdeco', name: 'Ар-деко' },
  ];
  /* neutral — «спокойные» группы: при оценке цвета дают 0,7, даже если не совпали с палитрой (ТЗ §17.4) */
  const COLOR_GROUPS = [
    { id: 'white', name: 'белый', hex: '#f4f4f2', neutral: true }, { id: 'beige', name: 'молочный / бежевый', hex: '#e6d8c3', neutral: true },
    { id: 'light-grey', name: 'светло-серый', hex: '#c9c9c7', neutral: true }, { id: 'dark-grey', name: 'тёмно-серый', hex: '#5a5c5e', neutral: false },
    { id: 'black', name: 'чёрный', hex: '#1d1d1f', neutral: false }, { id: 'light-wood', name: 'светлое дерево', hex: '#d8b98f', neutral: true },
    { id: 'mid-wood', name: 'среднее дерево', hex: '#a9764a', neutral: false }, { id: 'dark-wood', name: 'тёмное дерево', hex: '#5b3a24', neutral: false },
    { id: 'brown', name: 'коричневый', hex: '#7a5236', neutral: false }, { id: 'green', name: 'зелёный', hex: '#6f8f6a', neutral: false },
    { id: 'blue', name: 'синий', hex: '#2f4f7f', neutral: false }, { id: 'light-blue', name: 'голубой', hex: '#9dbcd4', neutral: false },
    { id: 'mustard', name: 'горчичный / жёлтый', hex: '#d0a53a', neutral: false }, { id: 'terracotta', name: 'терракота / красный', hex: '#b5553c', neutral: false },
    { id: 'pink', name: 'розовый', hex: '#e2a9ad', neutral: false }, { id: 'gold', name: 'золото / латунь', hex: '#b8943e', neutral: false },
    { id: 'chrome', name: 'хром / серебро', hex: '#b7bcc1', neutral: false }, { id: 'multi', name: 'разноцветный', hex: '#999999', neutral: false },
  ];
  const MATERIALS = [
    { id: 'fabric', name: 'ткань' }, { id: 'velour', name: 'велюр' }, { id: 'boucle', name: 'букле' }, { id: 'linen', name: 'лён' },
    { id: 'leather', name: 'кожа' }, { id: 'eco-leather', name: 'экокожа' }, { id: 'solid-wood', name: 'массив' }, { id: 'veneer', name: 'шпон' },
    { id: 'chipboard', name: 'ЛДСП / МДФ' }, { id: 'metal', name: 'металл' }, { id: 'glass', name: 'стекло' }, { id: 'stone', name: 'камень / керамика' },
    { id: 'plastic', name: 'пластик' }, { id: 'rattan', name: 'ротанг / плетение' }, { id: 'mirror', name: 'зеркало' },
  ];
  /* Назначения комнаты = категории каталога без «Техника», «Освещение», «Декор» + «Другое» (ТЗ §6.1, §30 п. 13) */
  const ROOM_PURPOSES = [
    { id: 'living', name: 'Гостиная' }, { id: 'bedroom', name: 'Спальня' }, { id: 'kids', name: 'Детская' }, { id: 'kitchen', name: 'Кухня' },
    { id: 'dining', name: 'Столовая' }, { id: 'office', name: 'Кабинет' }, { id: 'bath', name: 'Ванная' }, { id: 'toilet', name: 'Туалет' },
    { id: 'hall', name: 'Прихожая' }, { id: 'closet', name: 'Гардеробная' }, { id: 'balcony', name: 'Балкон' },
  ];
  const PALETTES = [
    { id: 'light', name: 'Светлая', v2: 'Светлая' }, { id: 'dark', name: 'Тёмная', v2: 'Тёмная' }, { id: 'warm', name: 'Тёплая', v2: 'Тёплая' },
    { id: 'cold', name: 'Холодная', v2: 'Холодная' }, { id: 'contrast', name: 'Контрастная', v2: 'Контрастная' }, { id: 'any', name: 'Неважно', v2: 'Неважно' },
  ];
  const PRICE_LEVELS = [{ id: 'economy', name: 'Экономно', v2: 'Экономно' }, { id: 'mid', name: 'Средний', v2: 'Средний' }, { id: 'premium', name: 'Премиум', v2: 'Премиум' }];
  const byId = (list) => new Map(list.map(x => [x.id, x]));
  /* Сопоставление подписей черновика v2 со справочником (ТЗ прил. Б.3): по названию, без учёта регистра */
  function fromLabel(list, label) {
    if (!label) return null; const l = String(label).trim().toLowerCase();
    const hit = list.find(x => x.name.toLowerCase() === l || (x.v2 && x.v2.toLowerCase() === l));
    return hit ? hit.id : null;
  }
  const hexToRgb = (hex) => { const h = hex.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  /* ΔE76 в Lab — для слияния цветов палитры (ТЗ §16.4: ΔE < 10) */
  function rgbToLab([r, g, b]) {
    const f = (c) => { c /= 255; return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; };
    const R = f(r), G = f(g), B = f(b);
    let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const g3 = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; x = g3(x); y = g3(y); z = g3(z);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }
  const deltaE = (h1, h2) => { const a = rgbToLab(hexToRgb(h1)), b = rgbToLab(hexToRgb(h2)); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };
  /* Ближайшая цветовая группа к hex */
  function nearestColorGroup(hex) { let best = null, bd = Infinity; for (const c of COLOR_GROUPS) { if (c.id === 'multi') continue; const d = deltaE(hex, c.hex); if (d < bd) { bd = d; best = c.id; } } return best; }
  return {
    VERSION, STYLES, COLOR_GROUPS, MATERIALS, ROOM_PURPOSES, PALETTES, PRICE_LEVELS,
    STYLE: byId(STYLES), COLOR: byId(COLOR_GROUPS), MATERIAL: byId(MATERIALS), PURPOSE: byId(ROOM_PURPOSES),
    fromLabel, deltaE, nearestColorGroup,
  };
});
