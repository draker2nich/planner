'use strict';
/* Код редактора — обычные скрипты с общими объявлениями верхнего уровня. Здесь те из них, что не трогают страницу,
   загружаются в отдельный контекст Node, чтобы геометрию ИИ‑дизайнера можно было проверять без браузера. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..', 'public');
const FILES = ['shared/catalog-types.js', 'js/editor/core/units.js', 'js/editor/core/state.js', 'js/editor/core/geometry.js', 'js/editor/core/derive.js',
  'js/editor/view3d/points.js', 'js/editor/view3d/materials.js', 'js/editor/furniture/geometry.js', 'js/editor/furniture/place.js', 'js/editor/ai/place.js', 'js/editor/ai/build.js'];

function loadEditor() {
  const noop = () => {};
  const el = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop }, setAttribute: noop, addEventListener: noop, append: noop, getContext: () => null });
  const sandbox = { console, Math, JSON, Map, Set, Date, Promise, setTimeout, clearTimeout, structuredClone,
    document: { getElementById: el, querySelector: el, createElement: el, body: el(), documentElement: el(), addEventListener: noop },
    location: { protocol: 'file:' }, localStorage: { getItem: () => null, setItem: noop }, navigator: {}, indexedDB: {} };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const ev = (code) => vm.runInContext(code, ctx);
  /* вызвать функцию редактора с аргументами из теста */
  const call = (name, ...args) => { sandbox.__args = args; return ev(`${name}(...__args)`); };
  return { ev, call, sandbox };
}

/* Прямоугольная комната w×h: W1 — верхняя стена (окно), W2 — правая, W3 — нижняя (дверь), W4 — левая */
function room(w = 5000, h = 4000, { door = true, window = true } = {}) {
  const vertices = [{ id: 'v1', x: 0, y: 0 }, { id: 'v2', x: w, y: 0 }, { id: 'v3', x: w, y: h }, { id: 'v4', x: 0, y: h }];
  const walls = [{ id: 'top', a: 'v1', b: 'v2' }, { id: 'right', a: 'v2', b: 'v3' }, { id: 'bottom', a: 'v3', b: 'v4' }, { id: 'left', a: 'v4', b: 'v1' }];
  const openings = [];
  if (window) openings.push({ id: 'o1', kind: 'window', name: 'Окно 1', wallId: 'top', offset: 1500, width: 1500, height: 1400, sill: 900 });
  if (door) openings.push({ id: 'o2', kind: 'door', name: 'Дверь 1', wallId: 'bottom', offset: 300, width: 900, height: 2000, hinge: 'left', swing: 'in' });
  return { vertices, walls, openings, wallHeight: 2700, wallThickness: 150, furniture: [], mode: 'furniture', unit: 'mm' };
}
let seq = 0;
/* Предмет плана; dims по умолчанию — типовые размеры формы */
function item(E, typeId, extra = {}) {
  const t = E.ev('TYPE').get(typeId), fo = extra.formId ? t.forms.find(f => f.id === extra.formId) : t.forms[0];
  const dims = Object.assign({}, fo.typical, extra.dims || {});
  const f = Object.assign({ id: extra.id || ('f' + (++seq)), typeId, formId: fo.id, productId: null, formAny: false, name: extra.name || t.name, constraints: {}, x: 0, y: 0, rot: 0, mirror: false, locked: false, warnings: [] }, extra, { dims });
  if ((fo.mount || t.mount) === 'wall' && f.elev == null) f.elev = dims.E || 0;
  return f;
}
module.exports = { loadEditor, room, item };
