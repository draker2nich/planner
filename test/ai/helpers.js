/* Помощники для фикстур и тестов ИИ: комнаты, проёмы и предметы в формате редактора (P.*). */
'use strict';
const G = require('../../public/shared/geometry.js');
const CT = require('../../public/shared/catalog-types.js');
const CATALOG = require('./fixtures/catalog.json');

const PRODUCTS = CATALOG.products;
const PRODUCT = new Map(PRODUCTS.map(p => [p.id, p]));
const productById = (id) => PRODUCT.get(id) || null;

/* Комната по вершинам (мм, y вниз). Стены w1…wn соединяют соседние вершины. */
function room(pts, opts = {}) {
  const vertices = pts.map(([x, y], i) => ({ id: 'v' + (i + 1), x, y }));
  const walls = vertices.map((v, i) => ({ id: 'w' + (i + 1), a: v.id, b: vertices[(i + 1) % vertices.length].id }));
  return { id: opts.id || 'p1', name: opts.name || 'Комната', unit: 'mm', wallHeight: opts.height || 2700, wallThickness: 150, vertices, walls, openings: [], furniture: [] };
}
const rect = (w, h, opts) => room([[0, 0], [w, 0], [w, h], [0, h]], opts);
/* Правильный многоугольник с n сторонами длины side */
function regular(n, side, opts) { const R = side / (2 * Math.sin(Math.PI / n)); const pts = []; for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / n; pts.push([Math.round(R + R * Math.cos(a)), Math.round(R + R * Math.sin(a))]); } return room(pts, opts); }

function wallInfo(p, wallNo) { const d = G.derive(p); const w = p.walls[wallNo - 1]; const i = d.W.get(w.id); const a = d.V.get(w.a), b = d.V.get(w.b); return { d, w, i, a, b, len: i.len }; }
/* Проём на стене wallNo: t — расстояние от первой вершины стены до начала проёма (или 'center') */
function opening(p, kind, wallNo, t, width, extra = {}) {
  const { w, i, len } = wallInfo(p, wallNo);
  const t0 = t === 'center' ? (len - width) / 2 : t;
  const offset = i.refIsA ? t0 : len - t0 - width;
  const o = { id: extra.id || `${kind[0]}${p.openings.length + 1}`, kind, wallId: w.id, offset, width, height: kind === 'window' ? 1500 : 2100, name: extra.name || (kind === 'door' ? 'Дверь' : kind === 'window' ? 'Окно' : 'Арка') };
  if (kind === 'window') o.sill = 900;
  if (kind === 'door') { o.hinge = 'left'; o.swing = 'in'; }
  Object.assign(o, extra); delete o.at;
  p.openings.push(o); return o;
}
const door = (p, wallNo, t, width = 800, extra) => opening(p, 'door', wallNo, t, width, extra);
const win = (p, wallNo, t, width = 1200, extra) => opening(p, 'window', wallNo, t, width, extra);
const arch = (p, wallNo, t, width = 1000, extra) => opening(p, 'arch', wallNo, t, width, extra);

let SEQ = 0;
function resetIds() { SEQ = 0; }
/* Предмет: productId (товар из фиксированного каталога) или пустышка с формой; policy — право ИИ */
function item(typeId, opts = {}) {
  const t = CT.TYPE.get(typeId); if (!t) throw new Error('type ' + typeId);
  const pr = opts.product ? PRODUCT.get(opts.product) : null; if (opts.product && !pr) throw new Error('product ' + opts.product);
  const formId = pr ? pr.formId : (opts.form || t.forms[0].id); const fo = CT.formOf(t, formId);
  const dims = pr ? { ...pr.dims } : { ...fo.typical, ...(opts.dims || {}) };
  const id = opts.id || `${typeId}-${++SEQ}`;
  return {
    id, typeId, formId, productId: pr ? pr.id : null, formAny: !!opts.formAny && !pr, name: opts.name || (pr ? pr.name : `${t.name} ${SEQ}`),
    constraints: opts.constraints || {}, dims, x: 0, y: 0, rot: 0, mirror: !!opts.mirror, locked: false, warnings: [],
    aiPolicy: opts.policy || 'free',
  };
}
/* Поставить напольный предмет тылом к стене wallNo; t — центр вдоль стены от первой вершины, gap — зазор */
function atWall(p, f, wallNo, t, gap = 0) {
  const { i, a, b, len } = wallInfo(p, wallNo);
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len; const nin = { x: -i.nx, y: -i.ny };
  const tc = t === 'center' ? len / 2 : t;
  const loc = G.fpPoly(CT.formOf(CT.TYPE.get(f.typeId), f.formId).fp, f.dims);
  f.x = a.x + ux * tc + nin.x * (gap + loc.h / 2); f.y = a.y + uy * tc + nin.y * (gap + loc.h / 2);
  f.rot = Math.atan2(i.nx, -i.ny) * 180 / Math.PI; return f;
}
/* Повесить настенный предмет на стену wallNo: t — центр вдоль стены от первой вершины, elev — высота низа */
function onWall(p, f, wallNo, t, elev) {
  const { w, i, len } = wallInfo(p, wallNo); const tc = t === 'center' ? len / 2 : t;
  const t0 = tc - f.dims.W / 2; f.wallId = w.id; f.offset = i.refIsA ? t0 : len - t0 - f.dims.W; f.elev = elev ?? f.dims.E ?? 0; return f;
}
function freeAt(f, x, y, rot = 0) { f.x = x; f.y = y; f.rot = rot; return f; }
function onBase(f, base, dx = 0, dy = 0) { f.baseId = base.id; f.x = base.x + dx; f.y = base.y + dy; f.rot = base.rot; return f; }
function add(p, ...items) { p.furniture.push(...items); return p; }
const clone = (x) => JSON.parse(JSON.stringify(x));

module.exports = { G, CT, PRODUCTS, PRODUCT, productById, room, rect, regular, opening, door, win, arch, item, atWall, onWall, freeAt, onBase, add, clone, resetIds, wallInfo };
