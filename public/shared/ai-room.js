/* =====================================================================
   Анализ помещения для ИИ-дизайнера (ТЗ §13): стены с внутренними нормалями, углы, проёмы,
   вход, зоны, области, главные оси, сетка занятости. Работает с любым простым многоугольником.
   Браузер: глобальный AIRoom (после geometry.js). Node: require('./ai-room.js').
   Система координат — как в редакторе: миллиметры, y вниз.
   ===================================================================== */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  // eslint-disable-next-line no-undef
  const api = factory(isNode ? require('./geometry.js') : FurniGeo);
  if (isNode) module.exports = api; else root.AIRoom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (G) {
  'use strict';
  const EPS = 1e-6;
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y }), mul = (a, k) => ({ x: a.x * k, y: a.y * k });
  const len = (a) => Math.hypot(a.x, a.y), norm = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const deg = (r) => r * 180 / Math.PI;

  class RoomError extends Error { constructor(code, message) { super(message); this.code = code; } }

  /* Проверка входа (ТЗ §13.1): замкнутый простой контур, площадь ≥ 1 м², габарит ≤ 50 × 50 м, проёмы на стенах */
  function checkProject(p, d) {
    if (!d.cycle) throw new RoomError('geometry_invalid', 'Контур не замкнут');
    if (d.cycle.length < 3) throw new RoomError('geometry_invalid', 'Меньше трёх стен');
    const poly = G.roomPolygon(d);
    const n = poly.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (G.segInter(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) throw new RoomError('geometry_invalid', 'Стены пересекаются');
    }
    const area = Math.abs(d.area);
    if (area < 1e6) throw new RoomError('geometry_invalid', 'Площадь меньше 1 м²');
    const bb = G.aabbOf(poly);
    if (bb.w > 50000 + 1 || bb.h > 50000 + 1) throw new RoomError('geometry_invalid', 'Комната больше 50 × 50 м');
    for (const o of p.openings || []) {
      const i = d.W.get(o.wallId); if (!i) throw new RoomError('geometry_invalid', 'Проём без стены');
      if (o.offset < -0.5 || o.offset + o.width > i.len + 0.5) throw new RoomError('geometry_invalid', 'Проём не помещается на стене');
    }
  }

  /* Разбиение многоугольника на выпуклые области: разрез от входящего угла продолжением стены (ТЗ §13.5).
     Для прямоугольных и Г/П-образных комнат даёт прямоугольники; маленькие куски (< 1,5 м²) не отделяются. */
  function isConvex(poly) { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length]; const cr = cross({ x: b.x - a.x, y: b.y - a.y }, { x: c.x - b.x, y: c.y - b.y }); if (Math.abs(cr) < EPS) continue; if (s === 0) s = Math.sign(cr); else if (Math.sign(cr) !== s) return false; } return true; }
  function rayHit(poly, from, dir, skip) {
    let best = null;
    for (let i = 0; i < poly.length; i++) {
      if (skip.includes(i)) continue;
      const a = poly[i], b = poly[(i + 1) % poly.length]; const e = { x: b.x - a.x, y: b.y - a.y };
      const den = cross(dir, e); if (Math.abs(den) < EPS) continue;
      const w = { x: a.x - from.x, y: a.y - from.y };
      const t = cross(w, e) / den, s = cross(w, dir) / den;
      if (t > 1 && s >= -EPS && s <= 1 + EPS && (!best || t < best.t)) best = { t, edge: i, s: Math.min(1, Math.max(0, s)), pt: { x: from.x + dir.x * t, y: from.y + dir.y * t } };
    }
    return best;
  }
  function splitAt(poly, i, hit) {
    // poly[i] — входящий угол; hit — точка на ребре hit.edge. Два многоугольника.
    const n = poly.length; const A = [], B = [];
    let k = i; A.push(poly[i]);
    for (;;) { k = (k + 1) % n; A.push(poly[k]); if (k === hit.edge) break; }
    A.push(hit.pt);
    B.push(hit.pt); k = hit.edge;
    for (;;) { k = (k + 1) % n; B.push(poly[k]); if (k === i) break; }
    const clean = (P) => P.filter((p, j) => { const q = P[(j + 1) % P.length]; return Math.hypot(p.x - q.x, p.y - q.y) > 1; });
    return [clean(A), clean(B)];
  }
  function decompose(poly, depth = 0) {
    if (depth > 12 || isConvex(poly)) return [poly];
    const area = G.shoelace(poly); const sgn = Math.sign(area);
    let best = null;
    for (let i = 0; i < poly.length; i++) {
      const pv = poly[(i - 1 + poly.length) % poly.length], c = poly[i], nx = poly[(i + 1) % poly.length];
      const cr = cross({ x: c.x - pv.x, y: c.y - pv.y }, { x: nx.x - c.x, y: nx.y - c.y });
      if (Math.sign(cr) === sgn || Math.abs(cr) < EPS) continue; // выпуклая вершина
      for (const dir of [norm({ x: c.x - pv.x, y: c.y - pv.y }), norm({ x: c.x - nx.x, y: c.y - nx.y })]) {
        const hit = rayHit(poly, c, dir, [(i - 1 + poly.length) % poly.length, i]);
        if (hit && (!best || hit.t < best.hit.t)) best = { i, hit };
      }
    }
    if (!best) return [poly];
    const [A, B] = splitAt(poly, best.i, best.hit);
    if (Math.abs(G.shoelace(A)) < 1.5e6 || Math.abs(G.shoelace(B)) < 1.5e6) return [poly];
    return [...decompose(A, depth + 1), ...decompose(B, depth + 1)];
  }

  /* Главный вход: самая широкая дверь, затем арка; без проёмов — середина самой длинной стены без окна (ТЗ §26 п. 2–3) */
  function pickEntrance(walls) {
    let best = null;
    for (const w of walls) for (const o of w.openings) if (o.kind === 'door' || o.kind === 'arch') {
      const score = (o.kind === 'door' ? 10000 : 0) + o.width;
      if (!best || score > best.score) best = { score, wallId: w.id, openingId: o.id, t0: o.t0, t1: o.t1, assumed: false };
    }
    if (best) return best;
    const cands = walls.filter(w => !w.openings.some(o => o.kind === 'window')); const pool = cands.length ? cands : walls;
    const w = pool.reduce((a, b) => (b.len > a.len ? b : a));
    return { wallId: w.id, openingId: null, t0: w.len / 2 - 450, t1: w.len / 2 + 450, assumed: true };
  }

  function buildRoom(p, opts = {}) {
    const d = G.derive(JSON.parse(JSON.stringify({ vertices: p.vertices, walls: p.walls, openings: p.openings || [] })));
    checkProject(p, d);
    const poly = G.roomPolygon(d);
    const signed = G.shoelace(poly);
    const n = poly.length;
    const wallIndex = new Map(p.walls.map((w, i) => [w.id, i + 1]));
    const walls = [];
    for (let i = 0; i < n; i++) {
      const va = d.cycle[i], vb = d.cycle[(i + 1) % n];
      const wall = p.walls.find(w => (w.a === va && w.b === vb) || (w.a === vb && w.b === va));
      const info = d.W.get(wall.id);
      const a = d.V.get(va), b = d.V.get(vb); const L = Math.hypot(b.x - a.x, b.y - a.y);
      const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
      // внутренняя нормаль: наружная из derive с обратным знаком
      const nIn = { x: -info.nx, y: -info.ny };
      const refIsA = info.ref.id === va;
      const w = { id: wall.id, index: wallIndex.get(wall.id), label: 'W' + wallIndex.get(wall.id), a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, aId: va, bId: vb, len: L, u, n: nIn, refIsA, openings: [], prev: null, next: null };
      // перевод offset от опорного конца (как в редакторе) ↔ параметр t от начала a
      w.tOf = (offset, width) => refIsA ? [offset, offset + width] : [L - offset - width, L - offset];
      w.offsetOf = (t0, width) => refIsA ? t0 : L - t0 - width;
      w.point = (t, inward = 0) => ({ x: a.x + u.x * t + nIn.x * inward, y: a.y + u.y * t + nIn.y * inward });
      walls.push(w);
    }
    for (let i = 0; i < n; i++) { walls[i].prev = walls[(i - 1 + n) % n].id; walls[i].next = walls[(i + 1) % n].id; }
    const W = new Map(walls.map(w => [w.id, w]));
    for (const o of p.openings || []) {
      const w = W.get(o.wallId); const [t0, t1] = w.tOf(o.offset, o.width);
      const sill = o.kind === 'window' ? (o.sill ?? 900) : 0;
      w.openings.push({ id: o.id, kind: o.kind, name: o.name, t0, t1, width: o.width, height: o.height, sill, head: sill + o.height, hinge: o.hinge, swing: o.swing, french: o.kind === 'window' && sill <= 100 });
    }
    for (const w of walls) w.openings.sort((a, b) => a.t0 - b.t0);
    // углы: внутренний угол у вершины между предыдущей и следующей стеной
    const corners = [];
    for (let i = 0; i < n; i++) {
      const wp = walls[(i - 1 + n) % n], wn = walls[i]; const vId = d.cycle[i];
      const back = { x: -wp.u.x, y: -wp.u.y };
      let ang = deg(Math.acos(Math.max(-1, Math.min(1, back.x * wn.u.x + back.y * wn.u.y))));
      if (!d.convex.get(vId)) ang = 360 - ang;
      corners.push({ id: 'C' + (i + 1), vertexId: vId, x: wn.a.x, y: wn.a.y, angle: ang, inner: ang < 180, prevWall: wp.id, nextWall: wn.id });
    }
    const height = p.wallHeight || 2700;
    const entrance = pickEntrance(walls);
    // признаки стен для модели и ориентиров
    const byLen = [...walls].sort((a, b) => b.len - a.len);
    byLen.forEach((w, k) => { w.rankByLength = k + 1; });
    const ew = W.get(entrance.wallId);
    for (const w of walls) {
      w.hasWindow = w.openings.some(o => o.kind === 'window');
      w.hasEntrance = w.id === entrance.wallId;
      w.oppositeEntrance = w.id !== ew.id && (w.n.x * ew.n.x + w.n.y * ew.n.y) < -Math.cos(30 * Math.PI / 180);
      w.freeLength = w.len - w.openings.filter(o => o.kind !== 'window').reduce((s, o) => s + (o.t1 - o.t0), 0);
    }
    // зоны у проёмов (ТЗ §13.4)
    const dview = { W: new Map(), cycle: d.cycle, V: d.V };
    for (const [id, info] of d.W) dview.W.set(id, info);
    const doorSwing = G.doorZones(p, d);
    const entryZones = [];
    for (const w of walls) for (const o of w.openings) if (o.kind === 'door' || o.kind === 'arch') {
      const p0 = w.point(o.t0), p1 = w.point(o.t1);
      entryZones.push({ id: o.id, wallId: w.id, pts: [p0, p1, w.point(o.t1, 600), w.point(o.t0, 600)] });
    }
    if (entrance.assumed) { const w = ew; entryZones.push({ id: 'assumed', wallId: w.id, assumed: true, pts: [w.point(entrance.t0), w.point(entrance.t1), w.point(entrance.t1, 600), w.point(entrance.t0, 600)] }); }
    const windowZones = [];
    for (const w of walls) for (const o of w.openings) if (o.kind === 'window') {
      const depth = o.french ? 600 : 300;
      windowZones.push({ id: o.id, wallId: w.id, sill: o.sill, french: o.french, pts: [w.point(o.t0), w.point(o.t1), w.point(o.t1, depth), w.point(o.t0, depth)] });
    }
    // области и главные оси
    const regions = decompose(poly.map(v => ({ x: v.x, y: v.y }))).map((pl, k) => ({ id: 'R' + (k + 1), poly: pl, area: Math.abs(G.shoelace(pl)), center: centroid(pl) }));
    const axes = [];
    for (const w of walls) { if (w.len < 1000) continue; const a = ((Math.atan2(w.u.y, w.u.x) * 180 / Math.PI) % 180 + 180) % 180; const hit = axes.find(x => Math.abs(x.angle - a) < 2 || Math.abs(x.angle - a) > 178); if (hit) hit.weight += w.len; else axes.push({ angle: a, weight: w.len }); }
    axes.sort((a, b) => b.weight - a.weight);
    const bb = G.aabbOf(poly);
    const room = {
      project: p, d, poly, area: Math.abs(signed), height, walls, W, corners, entrance, regions, axes, bbox: bb,
      zones: { doorSwing, entry: entryZones, window: windowZones },
      cell: opts.cell || (Math.max(bb.w, bb.h) > 30000 ? 100 : 50),
    };
    return room;
  }
  function centroid(pl) { let a = 0, cx = 0, cy = 0; for (let i = 0; i < pl.length; i++) { const p = pl[i], q = pl[(i + 1) % pl.length]; const c = p.x * q.y - q.x * p.y; a += c; cx += (p.x + q.x) * c; cy += (p.y + q.y) * c; } a /= 2; return a ? { x: cx / (6 * a), y: cy / (6 * a) } : G.aabbOf(pl); }

  /* ---------- Сетка занятости (ТЗ §13.5) ---------- */
  function makeGrid(room) {
    const c = room.cell, bb = room.bbox;
    const nx = Math.max(1, Math.ceil(bb.w / c)), ny = Math.max(1, Math.ceil(bb.h / c));
    const inside = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      const y = bb.y0 + (j + 0.5) * c;
      // пересечения горизонтали с контуром — быстрее, чем pointInPoly для каждой клетки
      const xs = [];
      const P = room.poly;
      for (let i = 0, k = P.length - 1; i < P.length; k = i++) { const a = P[i], b = P[k]; if ((a.y > y) !== (b.y > y)) xs.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y)); }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const i0 = Math.max(0, Math.ceil((xs[q] - bb.x0) / c - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[q + 1] - bb.x0) / c - 0.5));
        for (let i = i0; i <= i1; i++) inside[j * nx + i] = 1;
      }
    }
    return { c, nx, ny, x0: bb.x0, y0: bb.y0, inside };
  }
  /* Отметить многоугольник на сетке (значение v) */
  function rasterize(grid, pts, out, v = 1) {
    const { c, nx, ny, x0, y0 } = grid; const bb = G.aabbOf(pts);
    const j0 = Math.max(0, Math.floor((bb.y0 - y0) / c)), j1 = Math.min(ny - 1, Math.floor((bb.y1 - y0) / c));
    for (let j = j0; j <= j1; j++) {
      const y = y0 + (j + 0.5) * c; const xs = [];
      for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) { const a = pts[i], b = pts[k]; if ((a.y > y) !== (b.y > y)) xs.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y)); }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const i0 = Math.max(0, Math.ceil((xs[q] - x0) / c - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[q + 1] - x0) / c - 0.5));
        for (let i = i0; i <= i1; i++) out[j * nx + i] = v;
      }
    }
  }
  /* Расстояние до ближайшего препятствия или стены (мм) — двухпроходное преобразование (фаска 3-4) */
  function distanceField(grid, blocked, out) {
    const { nx, ny, c } = grid; const INF = 1e9; const dist = out && out.length === nx * ny ? out : new Float32Array(nx * ny);
    for (let k = 0; k < nx * ny; k++) dist[k] = (grid.inside[k] && !blocked[k]) ? INF : 0;
    const a = 3, b = 4;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; if (!dist[k]) continue; let v = dist[k]; if (i > 0) v = Math.min(v, dist[k - 1] + a); else v = Math.min(v, a); if (j > 0) { v = Math.min(v, dist[k - nx] + a); if (i > 0) v = Math.min(v, dist[k - nx - 1] + b); if (i < nx - 1) v = Math.min(v, dist[k - nx + 1] + b); } else v = Math.min(v, a); dist[k] = v; }
    for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) { const k = j * nx + i; if (!dist[k]) continue; let v = dist[k]; if (i < nx - 1) v = Math.min(v, dist[k + 1] + a); else v = Math.min(v, a); if (j < ny - 1) { v = Math.min(v, dist[k + nx] + a); if (i < nx - 1) v = Math.min(v, dist[k + nx + 1] + b); if (i > 0) v = Math.min(v, dist[k + nx - 1] + b); } else v = Math.min(v, a); dist[k] = v; }
    // в мм: одна клетка = 3 условных единицы; центр клетки на полклетки от края
    for (let k = 0; k < nx * ny; k++) dist[k] = dist[k] ? (dist[k] / 3) * c - c / 2 : 0;
    return dist;
  }
  const cellOf = (grid, p) => { const i = Math.floor((p.x - grid.x0) / grid.c), j = Math.floor((p.y - grid.y0) / grid.c); if (i < 0 || j < 0 || i >= grid.nx || j >= grid.ny) return -1; return j * grid.nx + i; };
  const cellCenter = (grid, k) => ({ x: grid.x0 + ((k % grid.nx) + 0.5) * grid.c, y: grid.y0 + (Math.floor(k / grid.nx) + 0.5) * grid.c });

  /* Поиск пути с максимальной «узкостью» (самый широкий проход) от старта до любой клетки цели.
     Возвращает ширину прохода (мм) = 2 × наименьшее расстояние до препятствия на пути, или 0. */
  function widestPath(grid, dist, starts, targetMask) {
    const { nx, ny } = grid; const best = new Float32Array(nx * ny); const heap = [];
    const push = (k, v) => { heap.push([v, k]); let i = heap.length - 1; while (i > 0) { const pr = (i - 1) >> 1; if (heap[pr][0] >= heap[i][0]) break; [heap[pr], heap[i]] = [heap[i], heap[pr]]; i = pr; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] > heap[m][0]) m = l; if (r < heap.length && heap[r][0] > heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    for (const s of starts) if (s >= 0 && dist[s] > 0) { best[s] = dist[s]; push(s, dist[s]); }
    while (heap.length) {
      const [v, k] = pop(); if (v < best[k]) continue;
      if (targetMask[k]) return 2 * v;
      const i = k % nx, j = (k - i) / nx;
      const nb = [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, j > 0 ? k - nx : -1, j < ny - 1 ? k + nx : -1];
      for (const q of nb) { if (q < 0 || dist[q] <= 0) continue; const w = Math.min(v, dist[q]); if (w > best[q]) { best[q] = w; push(q, w); } }
    }
    return 0;
  }
  /* То же без цели: для каждой клетки — наибольшее «узкое место» (мм до препятствия) на пути от стартов.
     Один проход даёт ширины проходов ко всем предметам сразу (Ж11, М1, М10). */
  function widestMap(grid, dist, starts) {
    const { nx, ny } = grid; const N = nx * ny; const best = new Float32Array(N);
    // двоичная куча на типизированных массивах (без лишних объектов — это горячая функция оценки М1)
    let cap = Math.max(1024, N), hv = new Float32Array(cap), hk = new Int32Array(cap), n = 0;
    const push = (k, v) => { if (n === cap) { cap *= 2; const a = new Float32Array(cap); a.set(hv); hv = a; const b = new Int32Array(cap); b.set(hk); hk = b; } let i = n++; while (i > 0) { const p = (i - 1) >> 1; if (hv[p] >= v) break; hv[i] = hv[p]; hk[i] = hk[p]; i = p; } hv[i] = v; hk[i] = k; };
    const pop = () => { const k = hk[0]; const v = hv[0]; n--; if (n > 0) { const lv = hv[n], lk = hk[n]; let i = 0; for (;;) { const l = 2 * i + 1; if (l >= n) break; const r = l + 1; const m = r < n && hv[r] > hv[l] ? r : l; if (hv[m] <= lv) break; hv[i] = hv[m]; hk[i] = hk[m]; i = m; } hv[i] = lv; hk[i] = lk; } popV = v; return k; };
    let popV = 0;
    for (const s of starts) if (s >= 0 && dist[s] > 0 && dist[s] > best[s]) { best[s] = dist[s]; push(s, dist[s]); }
    while (n > 0) {
      const k = pop(); const v = popV; if (v < best[k]) continue;
      const i = k % nx;
      if (i > 0) { const q = k - 1; if (dist[q] > 0) { const w = v < dist[q] ? v : dist[q]; if (w > best[q]) { best[q] = w; push(q, w); } } }
      if (i < nx - 1) { const q = k + 1; if (dist[q] > 0) { const w = v < dist[q] ? v : dist[q]; if (w > best[q]) { best[q] = w; push(q, w); } } }
      if (k >= nx) { const q = k - nx; if (dist[q] > 0) { const w = v < dist[q] ? v : dist[q]; if (w > best[q]) { best[q] = w; push(q, w); } } }
      if (k < N - nx) { const q = k + nx; if (dist[q] > 0) { const w = v < dist[q] ? v : dist[q]; if (w > best[q]) { best[q] = w; push(q, w); } } }
    }
    return best;
  }
  /* Клетки многоугольника (индексы внутри комнаты) — построчно, без маски на всю сетку */
  function cellsOf(grid, pts) {
    const { c, nx, ny, x0, y0, inside } = grid; const bb = G.aabbOf(pts); const out = [];
    const j0 = Math.max(0, Math.floor((bb.y0 - y0) / c)), j1 = Math.min(ny - 1, Math.floor((bb.y1 - y0) / c));
    for (let j = j0; j <= j1; j++) {
      const y = y0 + (j + 0.5) * c; const xs = [];
      for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) { const a = pts[i], b = pts[k]; if ((a.y > y) !== (b.y > y)) xs.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y)); }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const i0 = Math.max(0, Math.ceil((xs[q] - x0) / c - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[q + 1] - x0) / c - 0.5));
        for (let i = i0; i <= i1; i++) { const k = j * nx + i; if (inside[k]) out.push(k); }
      }
    }
    return out;
  }
  /* Достижимость: заливка по клеткам с расстоянием до препятствия ≥ thr от стартов (Ж11) */
  function reachMask(grid, dist, starts, thr, scratch) {
    const { nx, ny } = grid; let seen, q;
    if (scratch) { if (!scratch.seen || scratch.seen.length !== nx * ny) { scratch.seen = new Uint8Array(nx * ny); scratch.q = new Int32Array(nx * ny); } seen = scratch.seen; seen.fill(0); q = scratch.q; }
    else { seen = new Uint8Array(nx * ny); q = new Int32Array(nx * ny); }
    let h = 0, t = 0;
    for (const s of starts) if (s >= 0 && dist[s] >= thr && !seen[s]) { seen[s] = 1; q[t++] = s; }
    while (h < t) {
      const k = q[h++]; const i = k % nx;
      if (i > 0 && !seen[k - 1] && dist[k - 1] >= thr) { seen[k - 1] = 1; q[t++] = k - 1; }
      if (i < nx - 1 && !seen[k + 1] && dist[k + 1] >= thr) { seen[k + 1] = 1; q[t++] = k + 1; }
      if (k >= nx && !seen[k - nx] && dist[k - nx] >= thr) { seen[k - nx] = 1; q[t++] = k - nx; }
      if (k < nx * (ny - 1) && !seen[k + nx] && dist[k + nx] >= thr) { seen[k + nx] = 1; q[t++] = k + nx; }
    }
    return seen;
  }

  /* Разрешение селектора стены из отношений (ТЗ §18.6) */
  function resolveWall(room, sel, ctx = {}) {
    if (!sel) return [];
    if (room.W.has(sel)) return [room.W.get(sel)];
    const m = /^W(\d+)$/.exec(sel); if (m) { const w = room.walls.find(x => x.index === +m[1]); return w ? [w] : []; }
    if (sel === 'longest') return [room.walls.reduce((a, b) => (b.freeLength > a.freeLength ? b : a))];
    if (sel === 'with_window') return room.walls.filter(w => w.hasWindow);
    if (sel === 'without_window') return room.walls.filter(w => !w.hasWindow && w.len >= 300);
    if (sel === 'entrance') return room.walls.filter(w => w.hasEntrance);
    if (sel === 'opposite_entrance') return room.walls.filter(w => w.oppositeEntrance);
    const adj = /^adjacent_to:(.+)$/.exec(sel); if (adj) { const base = resolveWall(room, adj[1], ctx)[0]; return base ? [room.W.get(base.prev), room.W.get(base.next)] : []; }
    const same = /^same_as:(.+)$/.exec(sel); if (same && ctx.wallOfItem) { const wid = ctx.wallOfItem(same[1]); return wid ? [room.W.get(wid)] : []; }
    return [];
  }
  return { RoomError, buildRoom, checkProject, decompose, makeGrid, rasterize, distanceField, widestPath, widestMap, reachMask, cellsOf, cellOf, cellCenter, resolveWall, isConvex };
});
