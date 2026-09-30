/* =====================================================================
   Общая геометрия планировки — один источник для редактора (public/index.html),
   ИИ-дизайнера (server/ai/*) и тестов.
   Браузер: подключается после shared/catalog-types.js и даёт глобальный объект FurniGeo.
   Node: const G = require('./geometry.js').
   Координаты — миллиметры, углы — градусы. Локальная система предмета: центр габарита,
   перед смотрит в +y (у стены тыл — к стене, перед — в комнату).
   ===================================================================== */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  // eslint-disable-next-line no-undef
  const api = factory(isNode ? require('./catalog-types.js') : { TYPE, formOf });
  if (isNode) module.exports = api; else root.FurniGeo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CT) {
  'use strict';
  const { TYPE, formOf } = CT;

  /* ---------- Векторы и отрезки ---------- */
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y }), dot = (a, b) => a.x * b.x + a.y * b.y, hyp = (a) => Math.hypot(a.x, a.y);
  function orient(a, b, c) { const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); return Math.abs(v) < 1e-6 ? 0 : (v > 0 ? 1 : -1); }
  function onSeg(a, b, c) { return Math.min(a.x, b.x) - 1e-6 <= c.x && c.x <= Math.max(a.x, b.x) + 1e-6 && Math.min(a.y, b.y) - 1e-6 <= c.y && c.y <= Math.max(a.y, b.y) + 1e-6; }
  function segInter(p1, p2, p3, p4) {
    const o1 = orient(p1, p2, p3), o2 = orient(p1, p2, p4), o3 = orient(p3, p4, p1), o4 = orient(p3, p4, p2);
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSeg(p1, p2, p3)) return true; if (o2 === 0 && onSeg(p1, p2, p4)) return true;
    if (o3 === 0 && onSeg(p3, p4, p1)) return true; if (o4 === 0 && onSeg(p3, p4, p2)) return true; return false;
  }
  function distPtSeg(p, a, b) { const ab = sub(b, a), L2 = dot(ab, ab); if (L2 < 1e-9) return hyp(sub(p, a)); let t = dot(sub(p, a), ab) / L2; t = Math.max(0, Math.min(1, t)); return hyp(sub(p, { x: a.x + ab.x * t, y: a.y + ab.y * t })); }
  function shoelace(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a.x * b.y - b.x * a.y; } return s / 2; }
  function lineInter(p, d, q, e) { const den = d.x * e.y - d.y * e.x; if (Math.abs(den) < 1e-9) return null; const t = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / den; return { x: p.x + d.x * t, y: p.y + d.y * t }; }
  function pointInPoly(p, poly) { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) ins = !ins; } return ins; }

  /* ---------- Производные данные комнаты ----------
     cycle — порядок вершин замкнутого контура (внутренняя грань стен), area — знаковая площадь.
     У стены: nx, ny — нормаль НАРУЖУ комнаты; ref — опорный конец (от него отсчитываются offset проёмов
     и настенных предметов), rx, ry — направление от ref вдоль стены. */
  function derive(p) {
    const V = new Map(p.vertices.map(v => [v.id, v])); const deg = new Map(), adj = new Map();
    p.vertices.forEach(v => { deg.set(v.id, 0); adj.set(v.id, []); });
    p.walls.forEach(w => { deg.set(w.a, deg.get(w.a) + 1); deg.set(w.b, deg.get(w.b) + 1); adj.get(w.a).push(w); adj.get(w.b).push(w); });
    let cycle = null, area = 0;
    if (p.vertices.length >= 3 && p.walls.length === p.vertices.length && [...deg.values()].every(d => d === 2)) {
      const order = []; let cur = p.vertices[0].id, prevW = null, guard = 0;
      while (guard++ < p.vertices.length + 1) { order.push(cur); const w = adj.get(cur).find(x => x !== prevW); if (!w) break; const nxt = w.a === cur ? w.b : w.a; prevW = w; cur = nxt; if (cur === order[0]) break; }
      if (order.length === p.vertices.length && cur === order[0]) cycle = order;
    }
    const cyclePos = new Map(cycle ? cycle.map((id, i) => [id, i]) : []);
    if (cycle) area = shoelace(cycle.map(id => V.get(id)));
    const os = cycle ? (area > 0 ? -1 : 1) : 1;
    const W = new Map();
    for (const w of p.walls) {
      const a = V.get(w.a), b = V.get(w.b); const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1; const ux = dx / len, uy = dy / len;
      const ortho = Math.abs(dx) < 0.5 || Math.abs(dy) < 0.5, horiz = Math.abs(dy) < 0.5;
      let s = 1; if (cycle) { const n = cycle.length; s = ((cyclePos.get(w.a) + 1) % n === cyclePos.get(w.b)) ? 1 : -1; }
      const nx = -uy * s * os, ny = ux * s * os;
      const refIsA = (a.y < b.y - 0.5) || (Math.abs(a.y - b.y) <= 0.5 && a.x <= b.x); const ref = refIsA ? a : b, oth = refIsA ? b : a;
      W.set(w.id, { w, a, b, len: Math.hypot(dx, dy), ux, uy, ortho, horiz, nx, ny, ref, oth, rx: (oth.x - ref.x) / len, ry: (oth.y - ref.y) / len, refIsA });
    }
    const convex = new Map();
    if (cycle) { const n = cycle.length; for (let i = 0; i < n; i++) { const pv = V.get(cycle[(i - 1 + n) % n]), c = V.get(cycle[i]), nx = V.get(cycle[(i + 1) % n]); const cr = (c.x - pv.x) * (nx.y - c.y) - (c.y - pv.y) * (nx.x - c.x); convex.set(cycle[i], Math.sign(cr) === Math.sign(area)); } }
    p.closed = !!cycle;
    return { V, deg, adj, cycle, area, W, convex };
  }
  /* Многоугольник комнаты (вершины цикла) или null */
  function roomPolygon(d) { return d.cycle ? d.cycle.map(id => d.V.get(id)) : null; }

  /* ---------- Габарит предмета (локальные координаты, перед = +y) ---------- */
  function fpPoly(fp, d) {
    const P2 = (x, y) => ({ x, y }); let pts = [];
    const W = d.W ?? d.A ?? d.DIA ?? 500, Dd = d.D ?? d.L ?? d.DIA ?? 500;
    if (fp === 'rect') { pts = [P2(0, 0), P2(W, 0), P2(W, Dd), P2(0, Dd)]; }
    else if (fp === 'square') { pts = [P2(0, 0), P2(W, 0), P2(W, W), P2(0, W)]; }
    else if (fp === 'circle') { const r = (d.DIA || W) / 2; for (let i = 0; i < 32; i++) pts.push(P2(r + r * Math.cos(i / 32 * Math.PI * 2), r + r * Math.sin(i / 32 * Math.PI * 2))); }
    else if (fp === 'ellipse') { for (let i = 0; i < 32; i++) pts.push(P2(W / 2 + W / 2 * Math.cos(i / 32 * Math.PI * 2), Dd / 2 + Dd / 2 * Math.sin(i / 32 * Math.PI * 2))); }
    else if (fp === 'L') { const A = d.A, B = d.B, D2 = Math.min(d.D, A, B); pts = [P2(0, 0), P2(A, 0), P2(A, B), P2(A - D2, B), P2(A - D2, D2), P2(0, D2)]; }
    else if (fp === 'U') { const A = d.A, B = d.B, D2 = Math.min(d.D, A / 2, B); pts = [P2(0, 0), P2(A, 0), P2(A, B), P2(A - D2, B), P2(A - D2, D2), P2(D2, D2), P2(D2, B), P2(0, B)]; }
    else if (fp === 'quarter') { const r = d.R; pts = [P2(0, 0), P2(r, 0)]; for (let i = 1; i < 12; i++) { const a = i / 12 * Math.PI / 2; pts.push(P2(r * Math.cos(a), r * Math.sin(a))); } pts.push(P2(0, r)); }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; pts.forEach(p => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; return { pts: pts.map(p => P2(p.x - cx, p.y - cy)), w: x1 - x0, h: y1 - y0 };
  }
  const mountOf = (t, f) => f.mount || t.mount;
  function itemMount(f) { const t = TYPE.get(f.typeId); return t ? mountOf(t, formOf(t, f.formId)) : null; }
  function fLocal(f) { const t = TYPE.get(f.typeId); const fo = formOf(t, f.formId); return fpPoly(fo.fp, f.dims); }
  function fWorld(f) { const l = fLocal(f); const r = f.rot * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), m = f.mirror ? -1 : 1; return l.pts.map(p => ({ x: f.x + (p.x * m) * c - p.y * s, y: f.y + (p.x * m) * s + p.y * c })); }
  function aabbOf(pts) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; pts.forEach(p => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }); return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }; }
  function shrink(pts, mm) { const c = aabbOf(pts); return pts.map(p => { const dx = p.x - c.cx, dy = p.y - c.cy, L = Math.hypot(dx, dy) || 1; return { x: p.x - dx / L * mm, y: p.y - dy / L * mm }; }); }
  function segCross(p1, p2, p3, p4) { const o = (a, b, c) => { const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); return Math.abs(v) < 1 ? 0 : Math.sign(v); }; const o1 = o(p1, p2, p3), o2 = o(p1, p2, p4), o3 = o(p3, p4, p1), o4 = o(p3, p4, p2); return o1 * o2 < 0 && o3 * o4 < 0; }
  function polyIntersect(A0, B0) { const A = shrink(A0, 1), B = shrink(B0, 1); for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) if (segCross(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return true; return A.some(q => pointInPoly(q, B0)) || B.some(q => pointInPoly(q, A0)); }
  function insideRoom(pts, p, d) { const poly = roomPolygon(d); if (!poly) return false; const s = shrink(pts, 2); if (!s.every(q => pointInPoly(q, poly))) return false; for (const w of p.walls) { const i = d.W.get(w.id); for (let k = 0; k < s.length; k++) if (segCross(s[k], s[(k + 1) % s.length], i.a, i.b)) return false; } return true; }

  /* Поза предмета в мире {x, y, rot, mirror}; у настенных считается от стены и offset */
  function placementFrame(f, d) {
    const t = TYPE.get(f.typeId), fo = formOf(t, f.formId), mt = mountOf(t, fo);
    if (mt === 'wall') { const i = d.W.get(f.wallId); if (!i) return null; const c = { x: i.ref.x + i.rx * (f.offset + f.dims.W / 2), y: i.ref.y + i.ry * (f.offset + f.dims.W / 2) }; return { x: c.x - i.nx * f.dims.D / 2, y: c.y - i.ny * f.dims.D / 2, rot: Math.atan2(i.nx, -i.ny) * 180 / Math.PI, mirror: false }; }
    return { x: f.x, y: f.y, rot: f.rot, mirror: f.mirror };
  }
  /* Мировой габарит предмета (многоугольник) или null, если стена не найдена */
  function fWorldOf(f, p, d) {
    const t = TYPE.get(f.typeId); const fo = formOf(t, f.formId); const mt = mountOf(t, fo);
    if (mt === 'wall') { const i = d.W.get(f.wallId); if (!i) return null; const c = { x: i.ref.x + i.rx * (f.offset + f.dims.W / 2), y: i.ref.y + i.ry * (f.offset + f.dims.W / 2) }; const r = Math.atan2(i.nx, -i.ny); const dd = f.dims.D; const cx = c.x - i.nx * dd / 2, cy = c.y - i.ny * dd / 2; const l = fpPoly(fo.fp, f.dims); const cs = Math.cos(r), sn = Math.sin(r); return l.pts.map(q => ({ x: cx + q.x * cs - q.y * sn, y: cy + q.x * sn + q.y * cs })); }
    return fWorld(f);
  }
  /* Интервал по высоте [низ, верх], мм. Настенный — от elev; на основании — от верха основания;
     потолочный — от потолка вниз; напольный — от пола. */
  function heightInterval(f, p, items) {
    const t = TYPE.get(f.typeId); const mt = mountOf(t, formOf(t, f.formId)); const H = f.dims.H || 0;
    if (mt === 'wall') { const e = f.elev ?? f.dims.E ?? 0; return [e, e + H]; }
    if (mt === 'ceiling') { const top = p.wallHeight || 0; return [top - H, top]; }
    if (mt === 'ontop') { const b = (items || p.furniture || []).find(x => x.id === f.baseId); const bh = b ? (b.dims.H || 0) : 0; return [bh, bh + H]; }
    return [0, H];
  }
  const intervalsOverlap = (a, b) => a[0] < b[1] - 0.5 && b[0] < a[1] - 0.5;

  /* ---------- Зоны у проёмов ---------- */
  function doorZones(p, d) { const z = []; for (const o of p.openings) { if (o.kind !== 'door') continue; const i = d.W.get(o.wallId); if (!i) continue; const hingeA = o.hinge === 'left' ? o.offset : o.offset + o.width; const hp = { x: i.ref.x + i.rx * hingeA, y: i.ref.y + i.ry * hingeA }; const dirA = o.hinge === 'left' ? 1 : -1; const inward = o.swing === 'in' ? -1 : 1; const ax = { x: i.rx * dirA, y: i.ry * dirA }, ay = { x: i.nx * inward, y: i.ny * inward }; if (inward > 0) continue; const pts = [hp]; for (let k = 0; k <= 8; k++) { const a = k / 8 * Math.PI / 2; pts.push({ x: hp.x + (ax.x * Math.cos(a) + ay.x * Math.sin(a)) * o.width, y: hp.y + (ax.y * Math.cos(a) + ay.y * Math.sin(a)) * o.width }); } z.push({ name: o.name, id: o.id, pts }); } return z; }
  function windowZones(p, d, depth = 300) { const z = []; for (const o of p.openings) { if (o.kind !== 'window') continue; const i = d.W.get(o.wallId); if (!i) continue; const a = { x: i.ref.x + i.rx * o.offset, y: i.ref.y + i.ry * o.offset }, b = { x: i.ref.x + i.rx * (o.offset + o.width), y: i.ref.y + i.ry * (o.offset + o.width) }; const n = { x: -i.nx * depth, y: -i.ny * depth }; z.push({ name: o.name, id: o.id, pts: [a, b, { x: b.x + n.x, y: b.y + n.y }, { x: a.x + n.x, y: a.y + n.y }] }); } return z; }

  /* ---------- Проверки редактора ---------- */
  function furnitureWarnings(f, p, d) { const w = []; const pts = fWorldOf(f, p, d); if (!pts) return ['outside']; const t = TYPE.get(f.typeId); const mt = mountOf(t, formOf(t, f.formId)); if ((mt === 'floor' || mt === 'ceiling') && !insideRoom(pts, p, d)) w.push('outside'); if (mt === 'floor') { for (const z of doorZones(p, d)) if (polyIntersect(pts, z.pts)) { w.push('door'); break; } for (const z of windowZones(p, d)) if (polyIntersect(pts, z.pts)) { w.push('window'); break; } } return w; }
  /* Жёсткая проверка мебели проекта. opts.productById(id) → товар (для проверки фиксированных размеров).
     Возвращает текст первой ошибки или null. */
  function validateFurniture(p, d, opts = {}) {
    if (!d.cycle) return null; const items = p.furniture || []; const polys = new Map(); const strict = p._strict ? new Set(p._strict) : null; const chk = (f) => strict ? strict.has(f.id) : !(f.warnings || []).includes('outside');
    const productById = opts.productById || (() => null);
    for (const f of items) {
      const pts0 = fWorldOf(f, p, d); if (!pts0) return `${f.name}: стена не найдена`; polys.set(f.id, pts0); if (!chk(f)) continue; const t = TYPE.get(f.typeId); if (!t) return `${f.name}: неизвестный тип`; const fo = formOf(t, f.formId); const mt = mountOf(t, fo); const pts = pts0;
      if (mt === 'wall') { const i = d.W.get(f.wallId); if (f.offset < -0.5 || f.offset + f.dims.W > i.len + 0.5) return `${f.name}: не помещается на стене`; }
      else if (mt === 'ontop') { const b = items.find(x => x.id === f.baseId); if (!b) return `${f.name}: нет основания`; const bb = aabbOf(fWorldOf(b, p, d)), aa = aabbOf(pts); if (aa.x0 < bb.x0 - 1 || aa.x1 > bb.x1 + 1 || aa.y0 < bb.y0 - 1 || aa.y1 > bb.y1 + 1) return `${f.name}: выходит за пределы основания`; }
      else if (!insideRoom(pts, p, d)) return `${f.name}: вне комнаты или в стене`;
      if (f.productId) { const pr = productById(f.productId); if (pr) for (const k in pr.dims) if (k !== 'E' && Math.abs((f.dims[k] || 0) - pr.dims[k]) > 0.5) return `${f.name}: размеры товара фиксированы`; }
    }
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j]; if (!chk(a) && !chk(b)) continue; const ta = TYPE.get(a.typeId), tb = TYPE.get(b.typeId); const la = ta.layer, lb = tb.layer; const ma = mountOf(ta, formOf(ta, a.formId)), mb = mountOf(tb, formOf(tb, b.formId));
      let check = false; if (ma === 'floor' && mb === 'floor' && la === 'floor' && lb === 'floor') check = true; if (ma === 'ontop' && mb === 'ontop' && a.baseId === b.baseId) check = true; if (ma === 'ceiling' && mb === 'ceiling') check = true;
      // П4: настенные на одной стене конфликтуют, только если пересекаются и по высоте (ТВ над полкой — не пересечение)
      if (ma === 'wall' && mb === 'wall' && a.wallId === b.wallId) check = intervalsOverlap(heightInterval(a, p, items), heightInterval(b, p, items));
      if (check && polyIntersect(polys.get(a.id), polys.get(b.id))) return `${a.name} пересекает ${b.name}`;
    }
    return null;
  }

  /* ---------- Отпечаток снимка (§24.3 ТЗ) ----------
     SHA-256 на чистом JS: crypto.subtle в браузере доступен только по HTTPS и на localhost. */
  const K256 = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function utf8(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(i + 1); if (c2 >= 0xdc00 && c2 <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00); i++; } } if (c < 0x80) out.push(c); else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); } return out; }
  function sha256(str) {
    const bytes = utf8(str); const bitLen = bytes.length * 8; bytes.push(0x80); while (bytes.length % 64 !== 56) bytes.push(0);
    const hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0; bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]); const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < bytes.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = (bytes[off + 4 * i] << 24) | (bytes[off + 4 * i + 1] << 16) | (bytes[off + 4 * i + 2] << 8) | bytes[off + 4 * i + 3];
      for (let i = 16; i < 64; i++) { const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
      let a = H[0], b = H[1], c = H[2], dd = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) { const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K256[i] + w[i]) | 0, S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) | 0; h = g; g = f; f = e; e = (dd + t1) | 0; dd = c; c = b; b = a; a = (t1 + t2) | 0; }
      H[0] += a; H[1] += b; H[2] += c; H[3] += dd; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    return [...H].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }
  /* Канонический JSON: ключи по алфавиту, числа округлены до 0,1 */
  function canonical(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number') { if (!isFinite(v)) return 'null'; const r = Math.round(v * 10) / 10; return String(Object.is(r, -0) ? 0 : r); }
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  const pick = (o, keys) => { const r = {}; for (const k of keys) if (o[k] !== undefined && o[k] !== null) r[k] = o[k]; return r; };
  const FP_ITEM = ['id', 'typeId', 'formId', 'productId', 'formAny', 'dims', 'constraints', 'x', 'y', 'rot', 'mirror', 'wallId', 'offset', 'elev', 'baseId', 'aiPolicy'];
  /* Отпечаток: геометрия комнаты + то, что влияет на расстановку. Названия, замки, материалы, вид, единицы не входят. */
  function snapshotHash(p) {
    const body = {
      vertices: (p.vertices || []).map(v => pick(v, ['id', 'x', 'y'])),
      walls: (p.walls || []).map(w => pick(w, ['id', 'a', 'b'])),
      openings: (p.openings || []).map(o => pick(o, ['id', 'kind', 'wallId', 'offset', 'width', 'height', 'sill', 'head', 'radius', 'hinge', 'swing'])),
      wallHeight: p.wallHeight,
      furniture: (p.furniture || []).map(f => pick(f, FP_ITEM)),
    };
    return sha256(canonical(body));
  }

  return {
    sub, dot, hyp, orient, onSeg, segInter, distPtSeg, shoelace, lineInter, pointInPoly,
    derive, roomPolygon, fpPoly, mountOf, itemMount, fLocal, fWorld, aabbOf, shrink, segCross, polyIntersect, insideRoom,
    placementFrame, fWorldOf, heightInterval, intervalsOverlap, doorZones, windowZones, furnitureWarnings, validateFurniture,
    sha256, canonical, snapshotHash,
  };
});
