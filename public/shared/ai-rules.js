/* =====================================================================
   Правила эргономики ИИ-дизайнера (ТЗ §15, §20): жёсткие Ж1–Ж14, мягкие М1–М16, оценка 0–100,
   точка привязки (§11.4) и инварианты прав (§11.7). Один код для сервера (солвер, валидатор)
   и редактора (предупреждения при ручных правках, §10.3).
   Браузер: глобальный AIRules (после geometry.js, ai-knowledge/*.js, ai-room.js).
   Node: require('./ai-rules.js').
   Локальная система предмета: центр габарита, перед = +y, правый бок = +x (до зеркала).
   ===================================================================== */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = isNode
    ? factory(require('./catalog-types.js'), require('./geometry.js'), require('./ai-room.js'), require('./ai-knowledge/furniture.js'), require('./ai-knowledge/placement.js'))
    // eslint-disable-next-line no-undef
    : factory({ TYPE, formOf }, root.FurniGeo, root.AIRoom, root.AIFurniture, root.AIPlacement);
  if (isNode) module.exports = api; else root.AIRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CT, G, R, KF, KP) {
  'use strict';
  const VERSION = 'rules-1';
  const { TYPE, formOf } = CT;

  /* ---------- Числа правил (данные, ТЗ §15) ---------- */
  const SOLID_TOP = 2000;                 // «твёрдый» = интервал по высоте пересекается с [порог, 2000]
  const TOL = { touch: 2, base: 1, pos: 1, rot: 0.1, exact: 10, dims: 0.5, anchorGap: 10, cornerSnap: 60, cornerAngle: 2 };
  const OPENING_MARGIN = 50;              // Ж5, Ж8: ниже подоконника − 50, выше верха проёма + 50
  const CEIL_GAP = 20, BUNK_TOP = 600;    // Ж7
  const RADIATOR = { near: 100, tall: 300, tallH: 1200 };
  const TALL_CLOSED = new Set(['wardrobe', 'closet-system', 'showcase', 'tall-cabinet', 'bookcase', 'fridge']);
  const PASS = { min: 600, main: 900, secondary: 750, inflate: 300 };
  const FREE_FLOOR = { living: 0.4, bedroom: 0.3, kids: 0.3, _: 0.3 };
  const TV = { rMin: 1.2, rMax: 2.5, r0: 0.8, r1: 3.5, angOk: 30, angBad: 60, center: [1000, 1250], glare: 0.7, inchPerMm: 1 / 25.4, widthPerInch: 22.1 };
  const ADD_LIMIT = { total: 8, areaPerItem: 2e6 };
  const WEIGHTS = { M1: 8, M2: 6, M3: 5, M4: 6, M5: 4, M6: 4, M7: 3, M8: 3, M9: 3, M10: 3, M11: 10, M12: 8, M13: 6, M14: 5, M15: 7, M16: 1 };
  const CODES = { 'Ж1': 'OUTSIDE', 'Ж2': 'BLOCKED_BY', 'Ж3': 'DOOR_ZONE', 'Ж4': 'ENTRY_ZONE', 'Ж5': 'WINDOW_ZONE', 'Ж6': 'RADIATOR', 'Ж7': 'CEILING', 'Ж8': 'WALL_OPENING', 'Ж9': 'BASE', 'Ж10': 'SERVICE_ZONE', 'Ж11': 'ACCESS', 'Ж12': 'CONSTRAINTS', 'Ж13': 'BUDGET', 'Ж14': 'INVARIANT' };

  /* ---------- Мелкая геометрия ---------- */
  const rad = (d) => d * Math.PI / 180;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const lerp01 = (v, a, b) => clamp01((v - a) / (b - a));     // 0 при a, 1 при b
  const angDiff = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);  // 0…180
  const angBetween = (u, v) => { const L = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y) || 1; return Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / L))) * 180 / Math.PI; };
  const bbOverlap = (a, b, m = 0) => a.x0 < b.x1 + m && b.x0 < a.x1 + m && a.y0 < b.y1 + m && b.y0 < a.y1 + m;
  const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function polyDist(A, B) {
    if (G.polyIntersect(A, B)) return 0;
    let m = Infinity;
    for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) m = Math.min(m, G.distPtSeg(A[i], B[j], B[(j + 1) % B.length]), G.distPtSeg(B[j], A[i], A[(i + 1) % A.length]));
    return m;
  }
  function polyArea(pts) { return Math.abs(G.shoelace(pts)); }
  function centroid(pts) { const b = G.aabbOf(pts); return { x: b.cx, y: b.cy }; }

  /* Система предмета: мир ↔ локальные координаты */
  function mkFrame(fr) {
    const r = rad(fr.rot), c = Math.cos(r), s = Math.sin(r), m = fr.mirror ? -1 : 1;
    return {
      x: fr.x, y: fr.y, rot: fr.rot, mirror: !!fr.mirror, c, s, m,
      front: { x: -s, y: c }, right: { x: m * c, y: m * s },
      w: (lx, ly) => ({ x: fr.x + lx * m * c - ly * s, y: fr.y + lx * m * s + ly * c }),
      l: (p) => { const dx = p.x - fr.x, dy = p.y - fr.y; return { x: (dx * c + dy * s) * m, y: -dx * s + dy * c }; },
    };
  }
  const rectL = (x0, x1, y0, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

  /* ---------- Описание предмета ----------
     ctx: { items — все предметы проекта (для оснований), itemById(id), productById(id), policyOf(item) } */
  function mkCtx(room, items, opts = {}) {
    const byId = new Map(items.map(f => [f.id, f]));
    return {
      items, itemById: (id) => byId.get(id), productById: opts.productById || (() => null),
      height: room.height,
    };
  }
  function nameOf(f) { return f.name || (KF.get(f.typeId) || {}).name || f.typeId; }

  /* Зоны обслуживания в локальных координатах: функция глубины → многоугольник (ТЗ §14.3) */
  function zoneShapes(fp, dims, w, h, z) {
    const side = z.side, from = z.from || 0;
    if (side === 'lateral') return [(d) => rectL(-d, d, -h / 2, h / 2)];
    if (side === 'front' && fp === 'L') {
      const A = dims.A, B = dims.B, D2 = Math.min(dims.D, A, B);
      return [(d) => rectL(-A / 2, A / 2 - D2, -B / 2 + D2, -B / 2 + D2 + d), (d) => rectL(A / 2 - D2 - d, A / 2 - D2, -B / 2 + D2, B / 2)];
    }
    if (side === 'front' && fp === 'U') { const A = dims.A, B = dims.B, D2 = Math.min(dims.D, A / 2, B); return [(d) => rectL(-A / 2 + D2, A / 2 - D2, -B / 2 + D2, -B / 2 + D2 + d)]; }
    if (side === 'front' && fp === 'quarter') {
      const r = dims.R, k = Math.SQRT1_2, bulge = r * (1 - k);
      return [(d) => { const e = d + bulge; return [{ x: r, y: 0 }, { x: 0, y: r }, { x: e * k, y: r + e * k }, { x: r + e * k, y: e * k }].map(p => ({ x: p.x - r / 2, y: p.y - r / 2 })); }];
    }
    if (side === 'front') return [(d) => rectL(-w / 2, w / 2, h / 2, h / 2 + d)];
    if (side === 'back') return [(d) => rectL(-w / 2, w / 2, -h / 2 - d, -h / 2)];
    if (side === 'left') return [(d) => rectL(-w / 2 - d, -w / 2, -h / 2 + from, h / 2)];
    if (side === 'right') return [(d) => rectL(w / 2, w / 2 + d, -h / 2 + from, h / 2)];
    return [];
  }
  /* Доля зоны внутри комнаты (выборка 5×5 точек четырёхугольника) */
  function insideShare(pts, room) {
    if (pts.length !== 4) { let n = 0; for (const p of pts) if (G.pointInPoly(p, room.poly)) n++; return n / pts.length; }
    let n = 0, tot = 0; const [a, b, c, d] = pts;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      const u = (i + 0.5) / 5, v = (j + 0.5) / 5;
      const p = { x: (1 - v) * ((1 - u) * a.x + u * b.x) + v * ((1 - u) * d.x + u * c.x), y: (1 - v) * ((1 - u) * a.y + u * b.y) + v * ((1 - u) * d.y + u * c.y) };
      tot++; if (G.pointInPoly(p, room.poly)) n++;
    }
    return n / tot;
  }

  function describe(item, room, ctx = {}) {
    const t = TYPE.get(item.typeId); if (!t) return null;
    const fo = formOf(t, item.formId); const mount = G.mountOf(t, fo);
    const frame = G.placementFrame(item, room.d);
    const kf = KF.get(item.typeId) || { category: 'normal', solidHeight: 0 };
    const D = { id: item.id, item, typeId: item.typeId, formId: fo.id, fp: fo.fp, mount, name: nameOf(item), category: kf.category, rank: KP.rankOf(item.typeId), isRug: item.typeId === 'rug' };
    if (!frame) { D.invalid = 'wall'; D.zones = []; D.poly = []; D.hInt = [0, 0]; return D; }
    const fr = mkFrame(frame); D.fr = fr;
    const loc = G.fpPoly(fo.fp, item.dims); D.w = loc.w; D.h = loc.h;
    D.poly = loc.pts.map(p => fr.w(p.x, p.y)); D.polyS = G.shrink(D.poly, 1); D.bb = G.aabbOf(D.poly); D.area = polyArea(D.poly);
    // интервал по высоте (ТЗ §15.1, Ж2)
    const H = item.dims.H || 0;
    if (mount === 'wall') { const e = item.elev ?? item.dims.E ?? 0; D.hInt = [e, e + H]; }
    else if (mount === 'ceiling') D.hInt = [room.height - H, room.height];
    else if (mount === 'ontop') { const b = ctx.itemById ? ctx.itemById(item.baseId) : null; const bh = b ? (b.dims.H || 0) : 0; D.hInt = [bh, bh + H]; }
    else D.hInt = [0, H];
    D.solidH = kf.solidHeight || 0;
    D.solid = mount !== 'ceiling' && G.intervalsOverlap(D.hInt, [D.solidH, SOLID_TOP]);
    D.guests = KP.ZONE_GUESTS[item.typeId] || [];
    D.softGuests = (KP.SOFT_GUESTS[item.typeId] || []).concat(D.guests);
    // целиком вне комнаты (ТЗ §26 п. 7)
    if (mount === 'floor' || mount === 'ceiling') D.outside = !D.poly.some(q => G.pointInPoly(q, room.poly)) && !room.poly.some(q => G.pointInPoly(q, D.poly));
    // зоны обслуживания
    const product = item.productId && ctx.productById ? ctx.productById(item.productId) : null;
    D.zones = [];
    if (mount !== 'ceiling' && !D.outside) {
      for (const z of KP.zonesOf(item, product)) {
        const sides = z.side === 'around' ? ['front', 'back', 'left', 'right'] : [z.side];
        for (const side of sides) for (const shape of zoneShapes(fo.fp, item.dims, D.w, D.h, { side, from: z.from })) {
          const Z = { side, hard: z.hard || 0, soft: Math.max(z.soft || 0, z.hard || 0), oneOf: z.oneOf || null, around: z.side === 'around', seats: !!z.seats, shape };
          Z.at = (d) => shape(d).map(p => fr.w(p.x, p.y));
          if (Z.hard > 0) { Z.hardPts = Z.at(Z.hard); Z.hardS = G.shrink(Z.hardPts, 1); Z.hardBB = G.aabbOf(Z.hardPts); }
          if (Z.soft > 0) { Z.softPts = Z.at(Z.soft); Z.softS = G.shrink(Z.softPts, 1); Z.softBB = G.aabbOf(Z.softPts); }
          // сторона стола у стены: больше половины зоны за стеной — мест с этой стороны нет, зона не нужна
          const probe = Z.hardPts || Z.softPts;
          if (probe && Z.around && insideShare(probe, room) < 0.5) Z.ignored = true;
          if (Z.hardPts && !Z.ignored) Z.wallBlocked = !G.insideRoom(Z.hardPts, room.project, room.d);
          D.zones.push(Z);
        }
      }
    }
    return D;
  }
  const describeAll = (room, items, ctx) => items.map(f => describe(f, room, ctx)).filter(Boolean);

  /* ---------- Стены, к которым предмет стоит тылом ---------- */
  function backWall(D, room, maxGap) {
    if (!D.fr) return null;
    if (D.mount === 'wall') { const w = room.W.get(D.item.wallId); if (!w) return null; const [t0, t1] = w.tOf(D.item.offset, D.item.dims.W); return { wall: w, gap: 0, t: (t0 + t1) / 2 }; }
    if (D.mount !== 'floor') return null;
    const lim = (maxGap ?? KP.backGapOf(D.typeId)[1]) + TOL.anchorGap;
    const bc = D.fr.w(0, -D.h / 2); let best = null;
    for (const w of room.walls) {
      if (angBetween(D.fr.front, w.n) > 2) continue;
      const gap = (bc.x - w.a.x) * w.n.x + (bc.y - w.a.y) * w.n.y;
      if (gap < -TOL.touch || gap > lim) continue;
      const t = (bc.x - w.a.x) * w.u.x + (bc.y - w.a.y) * w.u.y;
      if (t < -D.w / 2 + 1 || t > w.len + D.w / 2 - 1) continue;
      if (!best || gap < best.gap) best = { wall: w, gap, t };
    }
    return best;
  }
  const distToWall = (p, w) => G.distPtSeg(p, w.a, w.b);

  /* ---------- Точка привязки (ТЗ §11.4) ---------- */
  function outerCornerLocal(fp, w, h) { return fp === 'quarter' ? { x: -w / 2, y: -h / 2 } : { x: w / 2, y: -h / 2 }; }
  function anchorOf(D, room) {
    const f = D.item;
    if (D.mount === 'wall') { const sp = KP.spec(D.typeId); return { kind: 'wallMount', wallId: f.wallId, tRef: f.offset + f.dims.W / 2, anchorV: sp.anchorV || 'bottom', v: sp.anchorV === 'center' ? D.hInt[0] + (f.dims.H || 0) / 2 : D.hInt[0], rot: D.fr.rot }; }
    if (D.mount === 'ontop') return { kind: 'ontop', baseId: f.baseId, x: D.fr.x, y: D.fr.y, rot: D.fr.rot, mirror: D.fr.mirror };
    if (D.mount === 'ceiling') return { kind: 'free', x: D.fr.x, y: D.fr.y, rot: D.fr.rot, mirror: D.fr.mirror };
    if (D.fp === 'L' || D.fp === 'quarter') {
      const oc = outerCornerLocal(D.fp, D.w, D.h); const p = D.fr.w(oc.x, oc.y);
      // «в углу» — только прямой угол 88–92° (ТЗ §13.3); у косого угла форма просто стоит у стены
      const c = room.corners.find(k => k.inner && Math.abs(k.angle - 90) <= TOL.cornerAngle && dist2(k, p) <= TOL.cornerSnap);
      if (c) return { kind: 'corner', vertexId: c.vertexId, x: c.x, y: c.y, rot: D.fr.rot, mirror: D.fr.mirror, side: oc.x > 0 ? 1 : -1 };
    }
    const bw = backWall(D, room);
    if (bw) {
      const lim = KP.backGapOf(D.typeId)[1] + TOL.anchorGap;
      for (const sx of [-1, 1]) {
        const pb = D.fr.w(sx * D.w / 2, -D.h / 2), pf = D.fr.w(sx * D.w / 2, D.h / 2);
        for (const wid of [bw.wall.prev, bw.wall.next]) {
          const aw = room.W.get(wid);
          if (distToWall(pb, aw) <= lim && distToWall(pf, aw) <= lim + D.h) return { kind: 'wallCorner', wallId: bw.wall.id, sideWallId: aw.id, sx, x: pb.x, y: pb.y, rot: D.fr.rot, mirror: D.fr.mirror };
        }
      }
      const bc = D.fr.w(0, -D.h / 2);
      return { kind: 'wall', wallId: bw.wall.id, x: bc.x, y: bc.y, rot: D.fr.rot, mirror: D.fr.mirror };
    }
    return { kind: 'free', x: D.fr.x, y: D.fr.y, rot: D.fr.rot, mirror: D.fr.mirror };
  }
  /* Поза нового товара от точки привязки: {x, y, rot, mirror} или {wallId, offset, elev} для настенных */
  function poseFromAnchor(a, typeId, formId, dims) {
    const t = TYPE.get(typeId), fo = formOf(t, formId); const loc = G.fpPoly(fo.fp, dims);
    if (a.kind === 'wallMount') return { wallId: a.wallId, offset: a.tRef - dims.W / 2, elev: a.anchorV === 'center' ? a.v - (dims.H || 0) / 2 : a.v };
    const fr = mkFrame({ x: 0, y: 0, rot: a.rot, mirror: a.mirror });
    const off = (lx, ly) => ({ x: lx * fr.right.x + ly * fr.front.x, y: lx * fr.right.y + ly * fr.front.y });
    let c;
    if (a.kind === 'wall') { const o = off(0, loc.h / 2); c = { x: a.x + o.x, y: a.y + o.y }; }
    else if (a.kind === 'wallCorner') { const o = off(-a.sx * loc.w / 2, loc.h / 2); c = { x: a.x + o.x, y: a.y + o.y }; }
    else if (a.kind === 'corner') { const oc = a.side ? { x: a.side * loc.w / 2, y: -loc.h / 2 } : outerCornerLocal(fo.fp, loc.w, loc.h); const o = off(oc.x, oc.y); c = { x: a.x - o.x, y: a.y - o.y }; }
    else c = { x: a.x, y: a.y };
    return { x: c.x, y: c.y, rot: a.rot, mirror: !!a.mirror, ...(a.kind === 'ontop' ? { baseId: a.baseId } : {}) };
  }

  /* ---------- Жёсткие правила ---------- */
  function V(rule, ids, text, numbers) { return { rule, code: CODES[rule], ids: ids.filter(Boolean), text, numbers: numbers || {}, inherited: false }; }

  /* Проверки предмета против комнаты: Ж1, Ж3, Ж4, Ж5, Ж7, Ж8 */
  function roomChecks(D, room) {
    const out = []; const f = D.item;
    if (D.invalid) { out.push(V('Ж1', [D.id], `${D.name}: стена не найдена`)); return out; }
    const exemptOpen = D.category === 'infra' || D.typeId === 'curtain';
    // Ж1
    if (D.mount === 'floor' || D.mount === 'ceiling') { if (!G.insideRoom(D.poly, room.project, room.d)) out.push(V('Ж1', [D.id], `${D.name}: вне комнаты или в стене`)); }
    else if (D.mount === 'wall') { const w = room.W.get(f.wallId); if (f.offset < -0.5 || f.offset + f.dims.W > w.len + 0.5 || !G.insideRoom(D.poly, room.project, room.d)) out.push(V('Ж1', [D.id], `${D.name}: не помещается на стене`, { need: f.dims.W, have: Math.round(w.len) })); }
    // Ж7
    const H = f.dims.H || 0;
    if (D.mount === 'wall') { if (D.hInt[0] < -0.5 || D.hInt[1] > room.height + 0.5) out.push(V('Ж7', [D.id], `${D.name}: выше потолка`, { top: Math.round(D.hInt[1]), ceiling: room.height })); }
    else if (D.mount === 'ceiling') { if (H > room.height) out.push(V('Ж7', [D.id], `${D.name}: не помещается по высоте`)); }
    else if (D.hInt[1] > room.height - CEIL_GAP + 0.5) out.push(V('Ж7', [D.id], `${D.name}: выше потолка`, { top: Math.round(D.hInt[1]), ceiling: room.height }));
    if (D.typeId === 'kids-bed' && D.formId === 'bunk' && room.height - H < BUNK_TOP) out.push(V('Ж7', [D.id], `${D.name}: над верхним ярусом меньше ${BUNK_TOP} мм`, { free: room.height - H }));
    if (D.mount === 'ceiling') return out;
    // Ж3: сектор открывания двери
    for (const z of room.zones.doorSwing) {
      const op = room.project.openings.find(o => o.id === z.id); const top = op ? op.height : 2100;
      if (!G.intervalsOverlap(D.hInt, [D.solidH, top])) continue;
      if (bbOverlap(D.bb, G.aabbOf(z.pts)) && G.polyIntersect(D.poly, z.pts)) out.push(V('Ж3', [D.id, z.id], `${D.name}: перекрывает открывание двери`));
    }
    // Ж4: вход
    if (D.solid) for (const z of room.zones.entry) if (bbOverlap(D.bb, G.aabbOf(z.pts)) && G.polyIntersect(D.poly, z.pts)) out.push(V('Ж4', [D.id, z.id === 'assumed' ? null : z.id], `${D.name}: загораживает вход`));
    // Ж5: перед окном
    if (!exemptOpen && D.solid) {
      const uw = KP.underWindowOf(D.typeId, D.formId);
      for (const z of room.zones.window) {
        if (D.mount === 'wall' && f.wallId === z.wallId) continue;   // на стене окна — это Ж8
        if (!bbOverlap(D.bb, G.aabbOf(z.pts)) || !G.polyIntersect(D.poly, z.pts)) continue;
        if (uw === false || D.hInt[1] > z.sill - OPENING_MARGIN + 0.5) out.push(V('Ж5', [D.id, z.id], `${D.name}: загораживает окно`, { top: Math.round(D.hInt[1]), sill: z.sill }));
      }
    }
    // Ж8: настенные не на проёмах
    if (D.mount === 'wall' && !exemptOpen) {
      const w = room.W.get(f.wallId); const [t0, t1] = w.tOf(f.offset, f.dims.W);
      for (const o of w.openings) {
        if (Math.min(t1, o.t1) - Math.max(t0, o.t0) <= 0.5) continue;
        const above = D.hInt[0] >= o.head + OPENING_MARGIN - 0.5, below = o.kind === 'window' && D.hInt[1] <= o.sill - OPENING_MARGIN + 0.5;
        if (!above && !below) out.push(V('Ж8', [D.id, o.id], `${D.name}: заходит на ${o.kind === 'window' ? 'окно' : 'проём'}`));
      }
    }
    return out;
  }

  /* Ж9: предмет на основании */
  function baseCheck(D, B) {
    if (D.mount !== 'ontop') return null;
    if (!B || B.invalid) return V('Ж9', [D.id], `${D.name}: нет основания`);
    const bt = TYPE.get(B.typeId); const allowed = (KF.get(D.typeId) || {}).bases;
    if (!bt || !bt.base || (allowed && !allowed.includes(B.typeId))) return V('Ж9', [D.id, B.id], `${D.name}: не ставится на ${B.name}`);
    const a = D.bb, b = B.bb;
    if (a.x0 < b.x0 - TOL.base || a.x1 > b.x1 + TOL.base || a.y0 < b.y0 - TOL.base || a.y1 > b.y1 + TOL.base) return V('Ж9', [D.id, B.id], `${D.name}: выходит за пределы основания`);
    return null;
  }

  /* Пара предметов: Ж2 (пересечение в 3D) и Ж6 (радиатор). Возвращает список нарушений */
  function exemptPair(A, B) { return A.isRug || B.isRug || A.item.baseId === B.id || B.item.baseId === A.id || (A.mount === 'ontop' && B.mount === 'ontop' && A.item.baseId !== B.item.baseId); }
  const NONE = Object.freeze([]);
  function pairChecks(A, B) {
    if (A.invalid || B.invalid || A.outside || B.outside) return NONE;
    if (A.typeId !== 'radiator' && B.typeId !== 'radiator' && !bbOverlap(A.bb, B.bb)) return NONE;
    const out = [];
    if (!exemptPair(A, B) && bbOverlap(A.bb, B.bb) && G.intervalsOverlap(A.hInt, B.hInt) && G.polyIntersect(A.poly, B.poly, A.polyS, B.polyS)) out.push(V('Ж2', [A.id, B.id], `${A.name} пересекает ${B.name}`));
    for (const [rad_, o] of (A.typeId === 'radiator' || B.typeId === 'radiator') ? [[A, B], [B, A]] : NONE) {
      if (rad_.typeId !== 'radiator' || o.mount === 'wall' || o.mount === 'ceiling' || !o.solid || o.item.baseId === rad_.id) continue;
      const tall = TALL_CLOSED.has(o.typeId) && (o.item.dims.H || 0) >= RADIATOR.tallH; const depth = tall ? RADIATOR.tall : RADIATOR.near;
      const zone = rectL(-rad_.w / 2, rad_.w / 2, rad_.h / 2, rad_.h / 2 + depth).map(p => rad_.fr.w(p.x, p.y));
      if (bbOverlap(o.bb, G.aabbOf(zone)) && G.polyIntersect(o.poly, zone)) out.push(V('Ж6', [o.id, rad_.id], `${o.name}: ближе ${depth} мм к радиатору`, { need: depth }));
    }
    return out;
  }

  /* Ж10: какие жёсткие зоны A перекрывает B (индексы в A.zones) */
  function blocksZones(A, B, soft = false) {
    if (!A.zones.length || (A.bbZ && B.bb && !bbOverlap(A.bbZ, B.bb))) return NONE;
    const res = [];
    if (A === B || A.invalid || B.invalid || B.outside || !B.solid || B.mount === 'ceiling') return res;
    if (B.item.baseId === A.id || A.item.baseId === B.id) return res;
    if ((soft ? A.softGuests : A.guests).includes(B.typeId)) return res;
    for (let i = 0; i < A.zones.length; i++) {
      const z = A.zones[i]; if (z.ignored) continue;
      const pts = soft ? z.softPts : z.hardPts, bb = soft ? z.softBB : z.hardBB;
      if (!pts || !bbOverlap(bb, B.bb)) continue;
      if (G.polyIntersect(pts, B.poly, soft ? z.softS : z.hardS, B.polyS)) res.push(i);
    }
    return res;
  }
  /* Индексы нарушенных зон: закрытая обычная зона или вся группа «хотя бы одна из» без свободной */
  function failingZones(A, blocked) {
    const out = []; const groups = new Map();
    for (let i = 0; i < A.zones.length; i++) {
      const z = A.zones[i]; if (z.ignored || !z.hardPts) continue;
      const bad = z.wallBlocked || (blocked && blocked.has(i));
      if (z.oneOf) { const g = groups.get(z.oneOf) || { any: false, idx: [] }; g.idx.push(i); if (!bad) g.any = true; groups.set(z.oneOf, g); }
      else if (bad) out.push(i);
    }
    for (const g of groups.values()) if (!g.any) out.push(...g.idx);
    return out;
  }
  /* Зоны удовлетворены? blocked — множество индексов, перекрытых предметами; стены учитываются здесь */
  function zonesOk(A, blocked) {
    const groups = new Map();
    for (let i = 0; i < A.zones.length; i++) {
      const z = A.zones[i]; if (z.ignored || !z.hardPts) continue;
      const bad = z.wallBlocked || (blocked && blocked.has(i));
      if (z.oneOf) { const g = groups.get(z.oneOf) || { any: false }; if (!bad) g.any = true; groups.set(z.oneOf, g); }
      else if (bad) return { ok: false, zone: i };
    }
    for (const [k, g] of groups) if (!g.any) return { ok: false, group: k };
    return { ok: true };
  }

  /* ---------- Сетка: препятствия, расстояния, ширины проходов (Ж11, М1, М9, М10) ---------- */
  function gridOf(room) { if (!room._grid) room._grid = R.makeGrid(room); return room._grid; }
  /* opts.base = {blocked, ids} — заранее растеризованные неподвижные предметы (солвер) */
  function passInfo(room, descs, opts = {}) {
    const grid = opts.grid || gridOf(room); const base = opts.base; const N = grid.nx * grid.ny;
    // opts.scratch: буферы сетки переиспользуются (быстрая проверка солвера; результат нельзя хранить)
    const sc = opts.scratch ? (grid._scratch || (grid._scratch = { blocked: new Uint8Array(N), dist: new Float32Array(N) })) : null;
    let blocked = null, dist = opts.dist;
    if (!dist) {
      blocked = sc ? sc.blocked : new Uint8Array(N);
      if (base) blocked.set(base.blocked); else if (sc) blocked.fill(0);
      for (const D of descs) if (!(base && base.ids.has(D.id)) && obstacle(D)) R.rasterize(grid, D.poly, blocked, 1);
      dist = R.distanceField(grid, blocked, sc ? sc.dist : null);
    }
    const r = inflateOf(room);
    const main = room.zones.entry.find(z => z.id === (room.entrance.openingId || 'assumed')) || room.zones.entry[0];
    const thr = r - grid.c / 2 - 0.01;   // допуск на дискретность сетки — полклетки
    let starts = main ? R.cellsOf(grid, main.pts) : [];
    const entranceOk = starts.some(k => dist[k] >= thr);
    // вход загорожен: человек протискивается — стартуем с проходимых клеток в 1,2 м от проёма, остальное проверяем как обычно
    if (main && !entranceOk) { const b = G.aabbOf(main.pts); starts = R.cellsOf(grid, [{ x: b.x0 - 1200, y: b.y0 - 1200 }, { x: b.x1 + 1200, y: b.y0 - 1200 }, { x: b.x1 + 1200, y: b.y1 + 1200 }, { x: b.x0 - 1200, y: b.y1 + 1200 }]).filter(k => dist[k] >= thr); }
    let best = null, reach = null;
    const pi = {
      grid, blocked, dist, r, need: 2 * r, main, starts, thr, entranceOk,
      get best() { if (!best) best = R.widestMap(grid, dist, starts); return best; },
      // ширина прохода к области: 2 × узкое место + клетка (поправка на дискретность)
      widthTo(pts) { const b = pi.best; let m = 0; for (const k of R.cellsOf(grid, pts)) if (b[k] > m) m = b[k]; return m > 0 ? 2 * m + grid.c : 0; },
      reaches(pts) { return pi.reachesCells(R.cellsOf(grid, pts)); },
      reachesCells(cells) { if (!reach) reach = R.reachMask(grid, dist, starts, thr, sc); for (const k of cells) if (reach[k]) return true; return false; },
    };
    return pi;
  }
  const obstacle = (D) => !D.invalid && !D.outside && D.solid && D.mount !== 'ontop';
  function inflateOf(room) { const ps = room.walls.flatMap(w => w.openings).filter(o => o.kind === 'door' || o.kind === 'arch'); const narrow = ps.length ? Math.min(...ps.map(o => o.width)) : Infinity; return Math.min(PASS.inflate, (narrow - 50) / 2); }
  function baseBlocked(room, descs, grid) { grid = grid || gridOf(room); const blocked = new Uint8Array(grid.nx * grid.ny); const ids = new Set(); for (const D of descs) if (obstacle(D)) { R.rasterize(grid, D.poly, blocked, 1); ids.add(D.id); } return { blocked, ids }; }
  /* Цель доступа предмета: зоны (или габарит), расширенные на r + клетку */
  function accessTargets(D, e) {
    const zs = D.zones.filter(z => !z.ignored && (z.hardPts || z.softPts));
    if (zs.length) return zs.map(z => { const pts = z.shape(z.hard || z.soft); const b = G.aabbOf(pts); return rectL(b.x0 - e, b.x1 + e, b.y0 - e, b.y1 + e).map(p => D.fr.w(p.x, p.y)); });
    return [rectL(-D.w / 2 - e, D.w / 2 + e, -D.h / 2 - e, D.h / 2 + e).map(p => D.fr.w(p.x, p.y))];
  }
  function needsAccess(D) { return !D.invalid && !D.outside && !D.isRug && D.category !== 'infra' && D.mount !== 'ceiling' && D.mount !== 'ontop' && (D.mount === 'floor' || D.zones.some(z => z.hardPts)); }
  function accessCheck(room, descs, pi) {
    pi = pi || passInfo(room, descs); const out = [];
    if (!pi.entranceOk) out.push(V('Ж11', [], 'Вход загорожен'));
    for (const z of room.zones.entry) if (z !== pi.main && !pi.reaches(z.pts)) out.push(V('Ж11', [z.id === 'assumed' ? null : z.id], 'Нет прохода между дверями'));
    const e = pi.r + pi.grid.c;
    for (const D of descs) {
      if (!needsAccess(D)) continue;
      // клетки целей зависят только от предмета и сетки — кешируются на описании
      let tc = D._tc; if (!tc || tc.grid !== pi.grid) { tc = { grid: pi.grid, cells: accessTargets(D, e).map(t => R.cellsOf(pi.grid, t)) }; D._tc = tc; }
      if (!tc.cells.some(c => pi.reachesCells(c))) out.push(V('Ж11', [D.id], `${D.name}: к нему не пройти`, { need: PASS.min }));
    }
    return out;
  }
  /* Ж12: товар соответствует типу, форме и ограничениям пустышки/исходного предмета */
  function productCheck(item, orig, product) {
    if (!product) return V('Ж12', [item.id], `${nameOf(item)}: нет товара`);
    if (product.typeId !== item.typeId) return V('Ж12', [item.id], `${nameOf(item)}: товар другого типа`);
    const formAny = !!(orig && orig.formAny && !orig.productId);
    const needForm = orig ? orig.formId : item.formId;
    if (!formAny && product.formId !== needForm) return V('Ж12', [item.id], `${nameOf(item)}: форма товара не совпадает`);
    const cons = (orig && orig.constraints) || item.constraints || {};
    const t = TYPE.get(item.typeId), fo = formOf(t, product.formId);
    let ext = null;
    if (formAny) { const l = G.fpPoly(fo.fp, product.dims); ext = { W: l.w, D: l.h, H: product.dims.H }; }
    for (const k of Object.keys(cons)) {
      const c = cons[k]; if (!c || c.mode === 'any') continue;
      const v = ext ? ext[k] : product.dims[k]; if (v == null) { if (ext) continue; return V('Ж12', [item.id], `${nameOf(item)}: нет размера ${k}`); }
      if (c.mode === 'exact' && Math.abs(v - c.exact) > TOL.exact) return V('Ж12', [item.id], `${nameOf(item)}: размер ${k} не совпадает`, { need: c.exact, have: v });
      if (c.mode === 'range' && ((c.min != null && v < c.min - TOL.dims) || (c.max != null && v > c.max + TOL.dims))) return V('Ж12', [item.id], `${nameOf(item)}: размер ${k} вне диапазона`, { min: c.min, max: c.max, have: v });
    }
    for (const k in product.dims) if (k !== 'E' && Math.abs((item.dims[k] || 0) - product.dims[k]) > TOL.dims) return V('Ж12', [item.id], `${nameOf(item)}: размеры не совпадают с товаром`);
    if (!handednessOk(product, item.mirror)) return V('Ж12', [item.id], `${nameOf(item)}: товар нельзя зеркалить`);
    return null;
  }

  /* Зеркало угловых форм (ТЗ §11.5): left — без зеркала, right — зеркально; reversible или пусто — как угодно */
  function handednessOk(product, mirror) {
    if (!product || !product.handedness || product.handedness === 'reversible') return true;
    const fp = formOf(TYPE.get(product.typeId), product.formId).fp; if (!['L', 'U', 'quarter'].includes(fp)) return true;
    return (product.handedness === 'right') === !!mirror;
  }

  /* ---------- Права и инварианты (ТЗ §11.7, Ж14) ---------- */
  function policyOf(item) { const pol = item.aiPolicy || 'keep'; return KF.normalizePolicy(item.typeId, !item.productId, pol); }
  const immovable = (orig) => { const p = policyOf(orig); return p === 'keep' || p === 'replace'; };
  function poseDiff(a, b, room) {
    const ta = TYPE.get(a.typeId), mt = G.mountOf(ta, formOf(ta, a.formId));
    if (mt === 'wall') return { d: (a.wallId === b.wallId ? 0 : 1e9) + Math.abs((a.offset || 0) - (b.offset || 0)) + Math.abs((a.elev ?? a.dims.E ?? 0) - (b.elev ?? b.dims.E ?? 0)), r: 0 };
    return { d: Math.hypot(a.x - b.x, a.y - b.y), r: angDiff(a.rot, b.rot) + (!!a.mirror !== !!b.mirror ? 180 : 0) };
  }
  function relTo(f, base) { const fb = mkFrame(base); const l = fb.l(f); return { x: l.x, y: l.y, rot: f.rot - base.rot }; }
  function invariants(result, original, opts = {}) {
    const out = []; const room = opts.room;
    const res = new Map((result.furniture || []).map(f => [f.id, f]));
    const org = new Map((original.furniture || []).map(f => [f.id, f]));
    const canon = (p) => G.canonical({ v: (p.vertices || []).map(v => [v.id, v.x, v.y]), w: (p.walls || []).map(w => [w.id, w.a, w.b]), o: (p.openings || []).map(o => [o.id, o.kind, o.wallId, o.offset, o.width, o.height, o.sill, o.hinge, o.swing]), h: p.wallHeight, t: p.wallThickness });
    if (canon(result) !== canon(original)) out.push(V('Ж14', [], 'Стены или проёмы изменены'));
    for (const [id, o] of org) {
      const r = res.get(id); const pol = policyOf(o);
      if (!r) { out.push(V('Ж14', [id], `${nameOf(o)}: предмет удалён`)); continue; }
      if (r.typeId !== o.typeId) { out.push(V('Ж14', [id], `${nameOf(o)}: изменён тип`)); continue; }
      const infra = KF.categoryOf(o.typeId) === 'infra';
      if (!o.productId && !infra && !r.productId) out.push(V('Ж14', [id], `${nameOf(o)}: пустышке не подобран товар`));
      if (pol === 'keep') {
        if (r.productId !== o.productId || r.formId !== o.formId || Object.keys(o.dims).some(k => k !== 'E' && Math.abs((o.dims[k] || 0) - (r.dims[k] || 0)) > TOL.dims)) out.push(V('Ж14', [id], `${nameOf(o)}: заменён товар при «Ничего не делать»`));
        const t = TYPE.get(o.typeId), mt = G.mountOf(t, formOf(t, o.formId));
        if (mt === 'ontop' && o.baseId) {
          const ob = org.get(o.baseId), rb = res.get(r.baseId);
          if (r.baseId !== o.baseId || !ob || !rb) { out.push(V('Ж14', [id], `${nameOf(o)}: снят с основания`)); continue; }
          const a = relTo(o, ob), b = relTo(r, rb);
          if (Math.hypot(a.x - b.x, a.y - b.y) > TOL.pos || angDiff(a.rot, b.rot) > TOL.rot) out.push(V('Ж14', [id], `${nameOf(o)}: сдвинут на основании`));
        } else { const d = poseDiff(o, r, room); if (d.d > TOL.pos || d.r > TOL.rot) out.push(V('Ж14', [id], `${nameOf(o)}: перемещён при «Ничего не делать»`, { moved: Math.round(d.d) })); }
      } else if (pol === 'move') {
        if (r.productId !== o.productId) out.push(V('Ж14', [id], `${nameOf(o)}: заменён товар при «Только перемещать»`));
        for (const k of new Set([...Object.keys(o.dims), ...Object.keys(r.dims)])) if (k !== 'E' && Math.abs((o.dims[k] || 0) - (r.dims[k] || 0)) > TOL.dims) { out.push(V('Ж14', [id], `${nameOf(o)}: изменены размеры`)); break; }
      } else if (pol === 'replace' && room) {
        const od = describe(o, room, { itemById: (x) => org.get(x) });
        if (!od || od.invalid) continue;
        const exp = poseFromAnchor(anchorOf(od, room), r.typeId, r.formId, r.dims);
        const t = TYPE.get(r.typeId), mt = G.mountOf(t, formOf(t, r.formId));
        if (mt === 'wall') { if (r.wallId !== exp.wallId || Math.abs(r.offset - exp.offset) > TOL.pos || Math.abs((r.elev ?? r.dims.E ?? 0) - exp.elev) > TOL.pos) out.push(V('Ж14', [id], `${nameOf(o)}: сдвинут при «Только заменять»`)); }
        else if (mt === 'ontop') {
          const ob = org.get(o.baseId), rb = res.get(r.baseId);
          if (r.baseId !== o.baseId || !ob || !rb) out.push(V('Ж14', [id], `${nameOf(o)}: перенесён на другое основание`));
          else { const a = relTo(o, ob), b = relTo(r, rb); if (Math.hypot(a.x - b.x, a.y - b.y) > TOL.pos + 0.5 || angDiff(a.rot, b.rot) > TOL.rot) out.push(V('Ж14', [id], `${nameOf(o)}: сдвинут на основании при «Только заменять»`)); }
        }
        else if (Math.hypot(r.x - exp.x, r.y - exp.y) > TOL.pos || angDiff(r.rot, exp.rot) > TOL.rot || !!r.mirror !== !!exp.mirror) out.push(V('Ж14', [id], `${nameOf(o)}: сдвинут при «Только заменять»`, { moved: Math.round(Math.hypot(r.x - exp.x, r.y - exp.y)) }));
      }
    }
    // добавления (ТЗ §11.6)
    const added = [...res.values()].filter(f => !org.has(f.id));
    if (added.length) {
      if (!opts.allowAdd) out.push(V('Ж14', added.map(f => f.id), 'Добавлены предметы без разрешения'));
      const byType = new Map(); for (const f of added) byType.set(f.typeId, (byType.get(f.typeId) || 0) + 1);
      for (const [tid, n] of byType) { const lim = (KF.get(tid) || {}).aiAdd || 0; if (n > lim) out.push(V('Ж14', added.filter(f => f.typeId === tid).map(f => f.id), `Добавлено больше разрешённого: ${tid}`, { n, max: lim })); }
      const lim = Math.min(ADD_LIMIT.total, opts.freeArea != null ? Math.floor(opts.freeArea / ADD_LIMIT.areaPerItem) : ADD_LIMIT.total);
      if (added.length > lim) out.push(V('Ж14', added.map(f => f.id), 'Слишком много добавлений', { n: added.length, max: lim }));
      for (const f of added) if (!f.productId) out.push(V('Ж14', [f.id], 'У добавленного предмета нет товара'));
    }
    return out;
  }

  /* ---------- Полная проверка (ТЗ §20.1) ----------
     opts: { original, productById, allowAdd, budget: {limit, total}, room } */
  function hardAll(room, descs, ctx) {
    const out = [];
    const live = descs.filter(D => !D.outside || D.mount !== 'floor');
    const byId = new Map(descs.map(D => [D.id, D]));
    for (const D of descs) {
      if (D.outside && ctx.ignoreOutside && ctx.ignoreOutside(D)) continue;
      out.push(...roomChecks(D, room));
      if (D.mount === 'ontop') { const v = baseCheck(D, byId.get(D.item.baseId)); if (v) out.push(v); }
    }
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) out.push(...pairChecks(live[i], live[j]));
    for (const A of live) {
      if (!A.zones.length) continue;
      const blocked = new Map();   // индекс зоны → все мешающие предметы
      for (const B of live) for (const k of blocksZones(A, B)) { if (!blocked.has(k)) blocked.set(k, []); blocked.get(k).push(B); }
      const r = zonesOk(A, new Set(blocked.keys()));
      if (!r.ok) {
        // в нарушении — все мешающие: если к унаследованной помехе добавился новый предмет, ключ другой (не усугублять, §11.8)
        const idxs = r.zone != null ? [r.zone] : A.zones.map((z, i) => (z.oneOf === r.group ? i : -1)).filter(i => i >= 0);
        const by = [...new Set(idxs.flatMap(i => blocked.get(i) || []))];
        const z = A.zones[idxs[0]];
        out.push(V('Ж10', [A.id, ...by.map(B => B.id)], by.length ? `${A.name}: мешает ${by.map(B => B.name).join(', ')}` : `${A.name}: нет места для подхода`, { need: z.hard }));
      }
    }
    out.push(...accessCheck(room, live));
    return out;
  }
  /* Нарушения исходной расстановки только среди неподвижных предметов (keep, replace, инженерное):
     унаследовать можно лишь то, что вызвано ими самими (§11.8); перемещаемые ИИ обязан исправить */
  function fixedViolations(original, opts = {}) {
    return validate({ ...original, furniture: (original.furniture || []).filter(f => immovable(f)) }, opts).violations;
  }
  const vkey = (v) => v.rule + '|' + [...v.ids].sort().join(',');
  const PHYSICAL = new Set(['Ж1', 'Ж2', 'Ж7', 'Ж8', 'Ж9']);
  function validate(project, opts = {}) {
    const room = opts.room || R.buildRoom(project);
    const items = project.furniture || [];
    const ctx = mkCtx(room, items, opts);
    const origById = new Map(((opts.original && opts.original.furniture) || []).map(f => [f.id, f]));
    // предмет с «Ничего не делать» целиком за стеной не учитывается (ТЗ §26 п. 7)
    ctx.ignoreOutside = (D) => { const o = origById.get(D.id) || D.item; return policyOf(o) === 'keep'; };
    // неподвижный — по праву и фактически (предмет «Ничего не делать» на переехавшем основании уже не неподвижен)
    const own = new Map(items.map(f => [f.id, f])); const src = opts.original ? origById : own;
    ctx.isFixed = (id) => { const o = src.get(id), f = own.get(id); if (!o || !immovable(o)) return false; if (policyOf(o) === 'replace' || !f) return true; return poseDiff(o, f).d <= TOL.pos && poseDiff(o, f).r <= TOL.rot && (o.baseId || null) === (f.baseId || null); };
    const all = describeAll(room, items, ctx);
    const ignored = all.filter(D => D.outside && ctx.ignoreOutside(D)).map(D => D.id);
    const descs = all.filter(D => !ignored.includes(D.id));
    const out = hardAll(room, descs, ctx);
    // Ж12: товары, выбранные ИИ
    for (const f of items) {
      const o = origById.get(f.id);
      if (opts.original && o && o.productId === f.productId) continue;
      if (!f.productId && KF.categoryOf(f.typeId) === 'infra') continue;
      if (!opts.original && !f.productId) continue;
      const v = productCheck(f, o, f.productId ? ctx.productById(f.productId) : null); if (v) out.push(v);
    }
    // Ж13
    if (opts.budget && opts.budget.limit != null && opts.budget.total > opts.budget.limit + 0.005) out.push(V('Ж13', [], 'Итог больше бюджета', { total: opts.budget.total, limit: opts.budget.limit }));
    // Ж14 и унаследованные нарушения (ТЗ §11.8)
    if (opts.original) {
      const freeArea = opts.freeArea;
      out.push(...invariants(project, opts.original, { room, allowAdd: opts.allowAdd, freeArea }));
      const base = opts.originalViolations || fixedViolations(opts.original, { room, productById: opts.productById });
      const had = new Set(base.map(vkey));
      const itemIds = new Set(items.map(f => f.id));
      // проход, закрытый только неподвижными предметами: те же нарушения Ж11 без всех остальных
      let fixedAccess = null;
      const accessByFixed = () => { if (!fixedAccess) { const fx = descs.filter(D => ctx.isFixed(D.id)); fixedAccess = new Set(accessCheck(room, fx).map(vkey)); } return fixedAccess; };
      for (const v of out) {
        if (v.rule === 'Ж14' || v.rule === 'Ж13' || v.rule === 'Ж12') continue;
        if (v.rule === 'Ж11' && !accessByFixed().has(vkey(v))) continue;
        // все участники неподвижны (проёмы — тоже) и нарушение было в исходной расстановке
        const fixedOnly = v.ids.every(id => origById.has(id) ? ctx.isFixed(id) : !itemIds.has(id));
        // физические нарушения (в стене, пересечение, потолок, проём, основание) у нового товара не наследуются
        const newProduct = PHYSICAL.has(v.rule) && v.ids.some(id => { const o = origById.get(id), f = items.find(x => x.id === id); return o && f && (o.productId !== f.productId || !o.productId); });
        if (fixedOnly && !newProduct && had.has(vkey(v))) v.inherited = true;
      }
    }
    return { ok: out.every(v => v.inherited), violations: out, ignored };
  }

  /* ---------- Мягкие правила (ТЗ §15.2, §20.2) ---------- */
  function freeDepth(A, z, blockers, room) {
    // наибольшая глубина зоны ≤ рекомендуемой, свободная от твёрдых предметов (кроме гостей) и внутри комнаты
    const clear = (d) => { if (d <= 0) return true; const pts = z.at(d); if (!G.insideRoom(pts, room.project, room.d)) return false; const bb = G.aabbOf(pts); for (const B of blockers) { if (B === A || !bbOverlap(bb, B.bb)) continue; if (G.polyIntersect(pts, B.poly)) return false; } return true; };
    if (clear(z.soft)) return z.soft;
    let lo = 0, hi = z.soft; for (let i = 0; i < 7; i++) { const mid = (lo + hi) / 2; if (clear(mid)) lo = mid; else hi = mid; }
    return lo;
  }
  function softBlockersOf(A, descs) { return descs.filter(B => B !== A && !B.invalid && !B.outside && B.solid && B.mount !== 'ceiling' && B.item.baseId !== A.id && A.item.baseId !== B.id && !A.softGuests.includes(B.typeId)); }
  function M2(room, descs) {
    const scores = []; let worst = null;
    for (const A of descs) {
      if (A.invalid || A.outside || !A.zones.length) continue;
      const bl = softBlockersOf(A, descs); const groups = new Map();
      A.zones.forEach((z) => {
        if (z.ignored || !(z.soft > 0)) return;
        const d = freeDepth(A, z, bl, room); const s = Math.min(1, d / z.soft);
        if (z.oneOf) { const g = groups.get(z.oneOf); if (!g || s > g.s) groups.set(z.oneOf, { s, d, z }); }
        else { scores.push(s); if (!worst || s < worst.s) worst = { s, d, z, A }; }
      });
      for (const g of groups.values()) { scores.push(g.s); if (!worst || g.s < worst.s) worst = { ...g, A }; }
    }
    if (!scores.length) return null;
    const s = scores.reduce((a, b) => a + b, 0) / scores.length;
    return { s, text: worst && worst.s < 1 ? `Место перед «${worst.A.name}» ${Math.round(worst.d)} мм при рекомендуемых ${worst.z.soft}` : 'Места для подхода к мебели достаточно', data: { worst: worst ? { id: worst.A.id, depth: Math.round(worst.d), need: worst.z.soft } : null } };
  }
  function M1(room, descs, pi) {
    const others = room.zones.entry.filter(z => z !== pi.main);
    let mainW;
    if (others.length) mainW = Math.min(...others.map(z => pi.widthTo(z.pts)));
    else { let m = 0, k0 = -1; for (let k = 0; k < pi.best.length; k++) if (pi.dist[k] > m) { m = pi.dist[k]; k0 = k; } mainW = k0 >= 0 ? 2 * pi.best[k0] + pi.grid.c : 0; }
    const sMain = lerp01(mainW, PASS.min, PASS.main);
    const e = pi.r + pi.grid.c; const sec = []; let narrow = null;
    for (const D of descs) {
      if (!needsAccess(D)) continue;
      const w = Math.max(0, ...accessTargets(D, e).map(t => pi.widthTo(t)));
      sec.push(lerp01(w, PASS.min, PASS.secondary)); if (!narrow || w < narrow.w) narrow = { w, D };
    }
    const sSec = sec.length ? sec.reduce((a, b) => a + b, 0) / sec.length : null;
    const s = sSec == null ? sMain : 0.5 * sMain + 0.5 * sSec;
    const text = narrow && narrow.w < PASS.secondary ? `Проход к «${narrow.D.name}» ${Math.round(narrow.w / 10) * 10} мм` : `Основной проход ${Math.round(mainW / 10) * 10} мм`;
    return { s, text, data: { main: Math.round(mainW), narrow: narrow ? { id: narrow.D.id, width: Math.round(narrow.w) } : null } };
  }
  function tvDiagonal(D, ctx) { const pr = D.item.productId && ctx.productById ? ctx.productById(D.item.productId) : null; const inch = (pr && pr.diagonal) || (D.item.dims.W || 1000) / TV.widthPerInch; return inch * 25.4; }
  function M3(room, descs, ctx) {
    const tvs = descs.filter(D => D.typeId === 'tv' && !D.invalid && !D.outside); if (!tvs.length) return null;
    let seats = descs.filter(D => D.typeId === 'sofa'); if (!seats.length) seats = descs.filter(D => D.typeId === 'armchair'); if (!seats.length) seats = descs.filter(D => D.typeId === 'bed'); if (!seats.length) return null;
    const res_ = [];
    for (const T of tvs) {
      const tc = T.fr.w(0, T.h / 2); let best = null;
      for (const S of seats) {
        const sc = S.fr.w(0, S.h / 2); const dir = { x: sc.x - tc.x, y: sc.y - tc.y };
        const ang = angBetween(T.fr.front, dir); const dist = Math.hypot(dir.x, dir.y);
        const r = dist / tvDiagonal(T, ctx);
        const sr = r < TV.rMin ? lerp01(r, TV.r0, TV.rMin) : r > TV.rMax ? 1 - lerp01(r, TV.rMax, TV.r1) : 1;
        const sa = 1 - lerp01(ang, TV.angOk, TV.angBad);
        const face = 1 - lerp01(angBetween(S.fr.front, { x: -dir.x, y: -dir.y }), 30, 90);
        let glare = 1;
        for (const z of room.zones.window) { const wc = centroid(z.pts); const toW = { x: wc.x - tc.x, y: wc.y - tc.y }; if (angBetween(T.fr.front, toW) <= 35 && (wc.x - sc.x) * dir.x + (wc.y - sc.y) * dir.y > 0) glare = TV.glare; }
        let sh = 1; if (T.mount === 'wall') { const c = (T.hInt[0] + T.hInt[1]) / 2; sh = c < TV.center[0] ? 1 - lerp01(TV.center[0] - c, 0, 300) : c > TV.center[1] ? 1 - lerp01(c - TV.center[1], 0, 300) : 1; }
        const s = sr * sa * face * glare * (0.5 + 0.5 * sh);
        if (!best || s > best.s) best = { s, r, ang, glare, S };
      }
      res_.push({ T, ...best });
    }
    const b = res_.reduce((a, c) => (c.s < a.s ? c : a));
    return { s: b.s, text: b.s >= 0.8 ? 'Телевизор хорошо виден с дивана' : `Телевизор: расстояние ${b.r.toFixed(1)} диагонали, угол ${Math.round(b.ang)}°${b.glare < 1 ? ', блики от окна' : ''}`, data: { r: +b.r.toFixed(2), angle: Math.round(b.ang) } };
  }
  function M4(room, descs, ctx) {
    const beds = descs.filter(D => (D.typeId === 'bed' || (D.typeId === 'kids-bed' && D.formId !== 'crib')) && !D.invalid && !D.outside); if (!beds.length) return null;
    const scores = []; const notes = [];
    const ec = entranceCenter(room);
    for (const B of beds) {
      const parts = []; const bw = backWall(B, room);
      parts.push(bw ? 1 : 0); if (!bw) notes.push('изголовье не у стены');
      const sides = B.zones.filter(z => z.oneOf === 'bedside'); const bl = softBlockersOf(B, descs);
      const ok = sides.map(z => freeDepth(B, z, bl, room) >= z.soft * 0.95);
      const wide = (B.item.dims.W || 0) >= 1200;
      if (sides.length) { const n = ok.filter(Boolean).length; parts.push(wide ? (n >= 2 ? 1 : n === 1 ? 0.5 : 0) : (n >= 1 ? 1 : 0)); if (wide && n < 2) notes.push('подход только с одной стороны'); }
      if (bw) { const w = bw.wall; const t0 = bw.t - B.w / 2, t1 = bw.t + B.w / 2; const win = w.openings.some(o => o.kind === 'window' && Math.min(t1, o.t1) - Math.max(t0, o.t0) > 100); parts.push(win ? 0 : 1); if (win) notes.push('изголовьем к окну'); }
      if (ec) { const a = angBetween(B.fr.front, { x: ec.x - B.fr.x, y: ec.y - B.fr.y }); parts.push(a <= 100 ? 1 : 0.3); if (a > 100) notes.push('дверь не видна с кровати'); }
      scores.push(parts.reduce((a, b) => a + b, 0) / parts.length);
    }
    const s = Math.min(...scores);
    return { s, text: notes.length ? `Кровать: ${notes.join(', ')}` : 'Кровать: изголовье у стены, подход с двух сторон' };
  }
  function entranceCenter(room) { const e = room.entrance; if (!e) return null; const w = room.W.get(e.wallId); return w.point((e.t0 + e.t1) / 2); }
  function nearestWindow(room, p) { let best = null; for (const w of room.walls) for (const o of w.openings) if (o.kind === 'window') { const a = w.point(o.t0), b = w.point(o.t1); const d = G.distPtSeg(p, a, b); if (!best || d < best.d) best = { d, c: w.point((o.t0 + o.t1) / 2), o, w }; } return best; }
  function M5(room, descs) {
    const desks = descs.filter(D => D.typeId === 'desk' && !D.invalid && !D.outside); if (!desks.length) return null;
    const ec = entranceCenter(room); const scores = []; const notes = [];
    for (const K of desks) {
      const parts = []; const nw = nearestWindow(room, { x: K.fr.x, y: K.fr.y });
      if (nw) {
        parts.push(1 - lerp01(nw.d, 2000, 4000)); if (nw.d > 2000) notes.push(`окно дальше ${Math.round(nw.d / 100) / 10} м`);
        const look = { x: -K.fr.front.x, y: -K.fr.front.y }; const a = angBetween(look, { x: nw.c.x - K.fr.x, y: nw.c.y - K.fr.y });
        parts.push(a >= 45 && a <= 135 ? 1 : a < 45 ? 0.6 : 0.3); if (a > 135) notes.push('окно за спиной');
      }
      if (ec) { const a = angBetween(K.fr.front, { x: ec.x - K.fr.x, y: ec.y - K.fr.y }); parts.push(a < 60 ? 0 : 1); if (a < 60) notes.push('спиной ко входу'); }
      if (parts.length) scores.push(parts.reduce((x, y) => x + y, 0) / parts.length);
    }
    if (!scores.length) return null;
    return { s: Math.min(...scores), text: notes.length ? `Рабочее место: ${notes.join(', ')}` : 'Рабочее место: свет сбоку, вход виден' };
  }
  function seatCapacity(D) {
    const d = D.item.dims;
    if (D.fp === 'circle') return Math.floor(Math.PI * (d.DIA || D.w) / 600);
    if (D.fp === 'ellipse') { const a = D.w / 2, b = D.h / 2; const per = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))); const ign = D.zones.filter(z => z.ignored).length; return Math.floor(per * (1 - ign / 4) / 600); }
    let n = 0; for (const z of D.zones) if (z.around && !z.ignored) n += Math.floor(((z.side === 'front' || z.side === 'back') ? D.w : D.h) / 600);
    return n;
  }
  function M6(room, descs, ctx) {
    const tables = descs.filter(D => (D.typeId === 'table' || D.typeId === 'meeting-table') && !D.invalid && !D.outside); if (!tables.length) return null;
    const people = ctx.people || 2; const cap = Math.max(...tables.map(seatCapacity));
    return { s: Math.min(1, cap / people), text: cap >= people ? `За столом ${cap} мест` : `За столом ${cap} мест при ${people} людях`, data: { seats: cap, people } };
  }
  function M7(room, descs) {
    const seats = descs.filter(D => (D.typeId === 'sofa' || D.typeId === 'armchair') && !D.invalid && !D.outside); if (seats.length < 2 || !seats.some(D => D.typeId === 'sofa')) return null;
    const pts = seats.map(S => S.fr.w(0, S.h / 2)); let maxD = 0; for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) maxD = Math.max(maxD, dist2(pts[i], pts[j]));
    // центр круга разговора — перед диваном на глубине зоны отдыха
    const sofa = seats.find(S => S.typeId === 'sofa'); const cc = sofa.fr.w(0, sofa.h / 2 + 900);
    const sc = 1 - lerp01(maxD, 2400, 3600);
    const face = seats.map((S, i) => 1 - lerp01(angBetween(S.fr.front, { x: cc.x - pts[i].x, y: cc.y - pts[i].y }), 45, 100));
    const s = 0.5 * sc + 0.5 * face.reduce((a, b) => a + b, 0) / face.length;
    return { s, text: s >= 0.8 ? 'Сидения собраны в зону разговора' : 'Сидения далеко друг от друга или не смотрят друг на друга', data: { spread: Math.round(maxD) } };
  }
  function M8(room, descs) {
    let checks = 0, pen = 0; const axes = room.axes.map(a => a.angle);
    for (const D of descs) {
      if (D.invalid || D.outside || D.mount !== 'floor' || D.fp === 'circle' || D.isRug) continue;
      checks++; const dev = Math.min(...axes.map(a => { const d = angDiff(D.fr.rot, a) % 90; return Math.min(d, 90 - d); }));
      if (dev > 1 && dev < 10) pen++;
    }
    // соседи у одной стены: почти одинаковый зазор до стены
    const byWall = new Map();
    for (const D of descs) { if (D.mount !== 'floor' || D.invalid || D.outside) continue; const bw = backWall(D, room, 300); if (bw) (byWall.get(bw.wall.id) || byWall.set(bw.wall.id, []).get(bw.wall.id)).push({ D, gap: bw.gap, t: bw.t }); }
    for (const list of byWall.values()) { list.sort((a, b) => a.t - b.t); for (let i = 0; i + 1 < list.length; i++) { const a = list[i], b = list[i + 1]; if ((b.t - b.D.w / 2) - (a.t + a.D.w / 2) > 300) continue; checks++; const dg = Math.abs(a.gap - b.gap); if (dg > 10 && dg < 60) pen++; } }
    // пары тумб у кровати симметричны
    for (const B of descs.filter(D => D.typeId === 'bed')) {
      const ns = descs.filter(D => D.typeId === 'nightstand' && !D.invalid && polyDist(D.poly, B.poly) < 300); if (ns.length !== 2) continue;
      checks++; const g = ns.map(N => polyDist(N.poly, B.poly)); const l = ns.map(N => B.fr.l(N.fr.w(0, -N.h / 2)).y);
      if (Math.abs(g[0] - g[1]) > 30 || Math.abs(l[0] - l[1]) > 30) pen++;
    }
    if (!checks) return null;
    return { s: 1 - pen / checks, text: pen ? 'Есть почти выровненные предметы' : 'Предметы выровнены' };
  }
  function M9(room, descs, pi, ctx) {
    let inside = 0, free = 0; let maxD = 0;
    for (let k = 0; k < pi.grid.inside.length; k++) if (pi.grid.inside[k]) { inside++; if (!pi.blocked[k]) free++; if (pi.dist[k] > maxD) maxD = pi.dist[k]; }
    const share = inside ? free / inside : 1; const codes = ctx.purpose || [];
    const target = codes.includes('living') ? FREE_FLOOR.living : codes.includes('bedroom') ? FREE_FLOOR.bedroom : FREE_FLOOR._;
    const s = 0.7 * Math.min(1, share / target) + 0.3 * lerp01(2 * maxD + pi.grid.c, 600, 1500);
    return { s, text: `Свободно ${Math.round(share * 100)}% пола`, data: { share: +share.toFixed(2) } };
  }
  function M10(room, descs, pi) {
    const wins = room.zones.window; if (!wins.length) return null;
    let shaded = 0;
    for (const z of wins) {
      const w = room.W.get(z.wallId); const o = w.openings.find(x => x.id === z.id);
      const tall = descs.some(D => { if (D.mount !== 'floor' || D.invalid || (D.item.dims.H || 0) < 1500) return false; const bw = backWall(D, room, 300); if (!bw || bw.wall.id !== w.id) return false; const t0 = bw.t - D.w / 2, t1 = bw.t + D.w / 2; const gap = Math.max(o.t0 - t1, t0 - o.t1); return gap >= -1 && gap < 300; });
      if (tall) shaded++;
    }
    const approach = wins.some(z => { const w = room.W.get(z.wallId), o = w.openings.find(x => x.id === z.id); return pi.reaches([w.point(o.t0), w.point(o.t1), w.point(o.t1, 600), w.point(o.t0, 600)]); });
    const s = 0.5 * (1 - shaded / wins.length) + 0.5 * (approach ? 1 : 0);
    return { s, text: !approach ? 'К окну не подойти' : shaded ? 'Высокая мебель рядом с окном' : 'К окну есть подход' };
  }
  function M16(room, descs) {
    const mass = new Map(); let total = 0, n = 0;
    for (const D of descs) {
      if (D.invalid || D.outside || D.isRug || D.mount === 'ceiling' || D.mount === 'ontop' || D.category === 'infra') continue;
      const m = D.area / 1e6 * (D.item.dims.H || 0) / 1000; if (m <= 0) continue;
      const bw = backWall(D, room, 300); let wid = bw && bw.wall.id;
      if (!wid) { let best = null; for (const w of room.walls) { const d = distToWall({ x: D.fr.x, y: D.fr.y }, w); if (!best || d < best.d) best = { d, id: w.id }; } wid = best.id; }
      mass.set(wid, (mass.get(wid) || 0) + m); total += m; n++;
    }
    if (n < 3 || total <= 0) return null;
    const share = Math.max(...mass.values()) / total;
    return { s: 1 - lerp01(share, 0.5, 1), text: share > 0.7 ? 'Мебель собрана у одной стены' : 'Мебель распределена по комнате' };
  }

  /* Мягкие правила. ctx: { people, purpose: [коды], productById, extra: {M11…M15: {s, text}} } */
  function soft(room, descs, ctx = {}) {
    const live = descs.filter(D => !D.invalid && !D.outside);
    const pi = passInfo(room, live);
    const out = {
      M1: M1(room, live, pi), M2: M2(room, live), M3: M3(room, live, ctx), M4: M4(room, live, ctx), M5: M5(room, live),
      M6: M6(room, live, ctx), M7: M7(room, live), M8: M8(room, live), M9: M9(room, live, pi, ctx), M10: M10(room, live, pi), M16: M16(room, live),
    };
    for (const k of Object.keys(ctx.extra || {})) out[k] = ctx.extra[k];
    return out;
  }
  function combine(softMap, weights = WEIGHTS) {
    let sw = 0, s = 0;
    for (const [k, v] of Object.entries(softMap)) { if (!v || v.s == null || !(k in weights)) continue; sw += weights[k]; s += weights[k] * clamp01(v.s); }
    return sw ? 100 * s / sw : 100;
  }
  function evaluate(project, opts = {}) {
    const room = opts.room || R.buildRoom(project);
    const ctx = mkCtx(room, project.furniture || [], opts);
    const descs = describeAll(room, project.furniture || [], ctx);
    const sm = soft(room, descs, { ...opts, productById: ctx.productById });
    return { score: combine(sm, opts.weights), soft: sm };
  }

  return {
    VERSION, SOLID_TOP, TOL, PASS, RADIATOR, WEIGHTS, CODES, OPENING_MARGIN,
    mkFrame, rectL, polyDist, angDiff, angBetween, bbOverlap, lerp01, clamp01,
    mkCtx, describe, describeAll, backWall, anchorOf, poseFromAnchor, outerCornerLocal,
    roomChecks, baseCheck, pairChecks, blocksZones, zonesOk, failingZones, passInfo, baseBlocked, accessCheck, vkey, PHYSICAL, accessTargets, needsAccess, productCheck,
    policyOf, immovable, invariants, validate, fixedViolations, handednessOk, soft, combine, evaluate, freeDepth, entranceCenter, nearestWindow, seatCapacity, gridOf,
  };
});
