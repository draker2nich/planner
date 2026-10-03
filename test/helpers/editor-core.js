'use strict';
/* Запуск ядра редактора в Node: те же файлы, что грузит браузер (public/js/editor/core/*, furniture/geometry.js),
   выполняются в изолированном контексте node:vm в том же порядке, что и на странице.
   Функции интерфейса, которые ядро вызывает (render, toast…), подменены пустыми. */
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const CORE_FILES = [
  'shared/catalog-types.js',
  'js/editor/core/units.js', 'js/editor/core/state.js', 'js/editor/core/geometry.js',
  'js/editor/core/derive.js', 'js/editor/core/rows.js', 'js/editor/core/history.js',
  'js/editor/furniture/geometry.js',
];
const STUBS = `
  var __calls = { render: 0, save: 0 };
  function render(){ __calls.render++; }
  function updateButtons(){} function updateTools(){} function updateModeUI(){} function updateWidget(){}
  function toast(){} function buildCatalog(){}
  var localStorage = { _m: {}, getItem(k){ return k in this._m ? this._m[k] : null; }, setItem(k, v){ this._m[k] = String(v); }, removeItem(k){ delete this._m[k]; } };
  var document = { getElementById(){ return { textContent: '' }; } };
  var location = { protocol: 'http:' };
`;

/* bare: true — без подмен страницы; так проверяется, что ядро при загрузке к ней не обращается */
function loadCore({ bare = false } = {}) {
  const ctx = vm.createContext({ console, setTimeout: () => 0, clearTimeout: () => {} });
  if (!bare) vm.runInContext(STUBS, ctx);
  for (const f of CORE_FILES) vm.runInContext(fs.readFileSync(path.join(PUBLIC, f), 'utf8'), ctx, { filename: f });
  /* Значение выражения из контекста. Через JSON: у объектов из другого контекста свои прототипы. */
  const ev = (expr) => { const s = vm.runInContext(`JSON.stringify((() => (${expr}))())`, ctx); return s === undefined ? undefined : JSON.parse(s); };
  const run = (code) => vm.runInContext(code, ctx);
  const call = (name, ...args) => { ctx.__a = JSON.stringify(args); return ev(`${name}(...JSON.parse(__a))`); };
  /* Загрузить проект как это делает редактор: normalizeProject → derive → первый снимок истории */
  const setProject = (p) => { ctx.__p = JSON.stringify(p); run('P = normalizeProject(JSON.parse(__p)); D = derive(P); hist = []; hi = -1; snapshot();'); };
  /* apply(Q => { code }) → null или текст ошибки */
  const apply = (code, opts = '{}') => ev(`apply(Q => { ${code} }, ${opts})`);
  return { ctx, ev, run, call, setProject, apply };
}

/* ---------- заготовки проектов ---------- */
const ring = (pts) => ({
  vertices: pts.map(([x, y], i) => ({ id: 'v' + i, x, y })),
  walls: pts.map((_, i) => ({ id: 'w' + i, a: 'v' + i, b: 'v' + ((i + 1) % pts.length) })),
});
const base = (over = {}) => ({ name: 'Тест', unit: 'mm', wallHeight: 2700, wallThickness: 150, wallParamsSet: true, openings: [], furniture: [], mode: 'walls', ...over });
/* Прямоугольная комната w×h; cw=false — обход в обратную сторону */
const rect = (w = 5400, h = 3900, over = {}, cw = true) => { const pts = [[0, 0], [w, 0], [w, h], [0, h]]; return base({ ...ring(cw ? pts : pts.slice().reverse()), ...over }); };
/* Г‑образная комната: 5000×3000 + 3000×2000, вогнутый угол в точке (3000, 3000) */
const lshape = (over = {}) => base({ ...ring([[0, 0], [5000, 0], [5000, 3000], [3000, 3000], [3000, 5000], [0, 5000]]), ...over });
const windowAt = (id, wallId, offset, width = 1000, over = {}) => ({ id, kind: 'window', name: 'Окно ' + id, wallId, offset, width, height: 1400, sill: 900, head: 400, ...over });
const doorAt = (id, wallId, offset, width = 800, over = {}) => ({ id, kind: 'door', name: 'Дверь ' + id, wallId, offset, width, height: 2000, hinge: 'left', swing: 'in', ...over });

module.exports = { loadCore, CORE_FILES, PUBLIC, rect, lshape, base, ring, windowAt, doorAt };
