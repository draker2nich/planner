/* =====================================================================
   Словарь отношений замысла (ТЗ §18.6): у каждого отношения — оценка выполнения 0–1 (М11, М12)
   и генерация кандидатных поз для солвера. Новое отношение добавляется здесь одной записью.
   Работает на описаниях предметов из AIRules.describe().
   Браузер: глобальный AIRelations (после ai-rules.js). Node: require('./ai-relations.js').
   ===================================================================== */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = isNode
    ? factory(require('./geometry.js'), require('./ai-room.js'), require('./ai-rules.js'), require('./ai-knowledge/placement.js'))
    // eslint-disable-next-line no-undef
    : factory(root.FurniGeo, root.AIRoom, root.AIRules, root.AIPlacement);
  if (isNode) module.exports = api; else root.AIRelations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (G, R, AR, KP) {
  'use strict';
  const VERSION = 'relations-1';
  const { lerp01, angBetween, angDiff, polyDist, backWall } = AR;
  const center = (D) => ({ x: D.fr.x, y: D.fr.y });
  const rotFacing = (v) => Math.atan2(-v.x, v.y) * 180 / Math.PI;   // поворот, при котором перед смотрит вдоль v
  const norm360 = (a) => ((a % 360) + 360) % 360;
  /* Расстояние между габаритами; если заведомо больше limit — нижняя оценка по прямоугольникам (быстро) */
  function gap(A, B, limit) {
    const dx = Math.max(0, A.bb.x0 - B.bb.x1, B.bb.x0 - A.bb.x1), dy = Math.max(0, A.bb.y0 - B.bb.y1, B.bb.y0 - A.bb.y1);
    const lb = Math.sqrt(dx * dx + dy * dy); if (limit != null && lb > limit) return lb;
    return polyDist(A.poly, B.poly);
  }
  const lim = (range, fall) => (range ? range[1] : 0) + fall + 1;
  function rangeScore(v, range, fall = 300) { if (!range) return 1; const [a, b] = range; if (v >= a - 0.5 && v <= b + 0.5) return 1; const out = v < a ? a - v : v - b; return 1 - lerp01(out, 0, fall); }
  function ptPolyDist(p, poly) { if (G.pointInPoly(p, poly)) return 0; let m = Infinity; for (let i = 0; i < poly.length; i++) m = Math.min(m, G.distPtSeg(p, poly[i], poly[(i + 1) % poly.length])); return m; }
  function segPolyDist(a, b, poly) { let m = Math.min(ptPolyDist(a, poly), ptPolyDist(b, poly)); for (const p of poly) m = Math.min(m, G.distPtSeg(p, a, b)); for (let i = 0; i < poly.length; i++) if (G.segInter(a, b, poly[i], poly[(i + 1) % poly.length])) return 0; return m; }
  /* Шаблон группы: диапазон/зазор для пары (член, якорь) — умолчания для отношений без чисел */
  function groupSpec(aType, bType) { for (const g of Object.values(KP.GROUPS)) if (g.anchor.includes(bType) && g.members[aType]) return g.members[aType]; return null; }
  const DEFAULT_RANGE = { in_front_of: [0, 1000], opposite: [1500, 3500], beside: [0, 300], distance: [0, 1000] };

  /* Окружение: env = { room, get(id) → описание, all: [описания] } */
  function walls(env, sel) {
    if (!sel) return null;
    return R.resolveWall(env.room, sel, { wallOfItem: (id) => { const D = env.get(id); const bw = D && backWall(D, env.room); return bw ? bw.wall.id : null; } });
  }
  function windows(room) { const out = []; for (const w of room.walls) for (const o of w.openings) if (o.kind === 'window') out.push({ w, o, a: w.point(o.t0), b: w.point(o.t1) }); return out; }
  function entranceSeg(room) { const e = room.entrance; const w = room.W.get(e.wallId); return { a: w.point(e.t0), b: w.point(e.t1) }; }
  function freeSegments(w) {
    const cuts = w.openings.filter(o => o.kind !== 'window').map(o => [o.t0, o.t1]).sort((a, b) => a[0] - b[0]); const segs = []; let t = 0;
    for (const [a, b] of cuts) { if (a > t) segs.push([t, a]); t = Math.max(t, b); } if (t < w.len) segs.push([t, w.len]); return segs;
  }
  const regionOf = (room, id) => room.regions.find(r => r.id === id);
  const cornerOf = (room, id) => room.corners.find(c => c.id === id);

  /* ---------- Оценки 0–1 ---------- */
  const SCORE = {
    against_wall(r, A, env) { const bw = backWall(A, env.room); if (!bw) return 0; const ws = walls(env, r.wall); return !ws || ws.some(w => w.id === bw.wall.id) ? 1 : 0; },
    in_corner(r, A, env) { const cs = r.corner ? [cornerOf(env.room, r.corner)].filter(Boolean) : env.room.corners.filter(c => c.inner); if (!cs.length) return 0; const d = Math.min(...cs.map(c => ptPolyDist(c, A.poly))); return 1 - lerp01(d, 150, 1000); },
    centered_on_wall(r, A, env) {
      const bw = backWall(A, env.room); if (!bw) return 0; const ws = walls(env, r.wall); if (ws && !ws.some(w => w.id === bw.wall.id)) return 0;
      const seg = freeSegments(bw.wall).find(([a, b]) => bw.t >= a - 1 && bw.t <= b + 1) || [0, bw.wall.len];
      return 1 - lerp01(Math.abs(bw.t - (seg[0] + seg[1]) / 2), 50, 500);
    },
    near_window(r, A, env) { const ws = windows(env.room); if (!ws.length) return 0; const D = r.dist || 1500; const d = Math.min(...ws.map(x => segPolyDist(x.a, x.b, A.poly))); return 1 - lerp01(d, D, 2 * D); },
    away_from_window(r, A, env) { const ws = windows(env.room); if (!ws.length) return 1; const D = r.dist || 1500; const d = Math.min(...ws.map(x => segPolyDist(x.a, x.b, A.poly))); return lerp01(d, 0, D); },
    under_window(r, A, env) {
      const bw = backWall(A, env.room); if (!bw) return 0; const t0 = bw.t - A.w / 2, t1 = bw.t + A.w / 2;
      for (const o of bw.wall.openings) { if (o.kind !== 'window') continue; const ov = Math.min(t1, o.t1) - Math.max(t0, o.t0); if (ov >= 0.5 * Math.min(A.w, o.t1 - o.t0) && A.hInt[1] <= o.sill - AR.OPENING_MARGIN + 0.5) return 1; }
      return 0;
    },
    near_entrance(r, A, env) { const e = entranceSeg(env.room); const D = r.dist || 1500; return 1 - lerp01(segPolyDist(e.a, e.b, A.poly), D, 2 * D); },
    away_from_entrance(r, A, env) { const e = entranceSeg(env.room); const D = r.dist || 2000; return lerp01(segPolyDist(e.a, e.b, A.poly), 0, D); },
    facing(r, A, env, B) { const m = r.maxAngle || 20; const ang = angBetween(A.fr.front, { x: B.fr.x - A.fr.x, y: B.fr.y - A.fr.y }); return 1 - lerp01(ang, m, m + 40); },
    opposite(r, A, env, B) {
      const fa = 1 - lerp01(angBetween(A.fr.front, { x: B.fr.x - A.fr.x, y: B.fr.y - A.fr.y }), 25, 65);
      const fb = 1 - lerp01(angBetween(B.fr.front, { x: A.fr.x - B.fr.x, y: A.fr.y - B.fr.y }), 25, 65);
      const rg = r.range || DEFAULT_RANGE.opposite; return fa * fb * rangeScore(gap(A, B, lim(rg, 800)), rg, 800);
    },
    in_front_of(r, A, env, B) {
      const l = B.fr.l(center(A)); if (l.y <= B.h / 2) return 0;
      const range = r.range || (groupSpec(A.typeId, B.typeId) || {}).range || DEFAULT_RANGE.in_front_of;
      return (1 - lerp01(Math.abs(l.x), 100, Math.max(150, B.w / 2))) * rangeScore(gap(A, B, lim(range, 300)), range);
    },
    beside(r, A, env, B) {
      const l = B.fr.l(center(A)); const side = r.side || 'any';
      if (Math.abs(l.x) < B.w / 2 - 1) return 0;
      if (Math.abs(l.y) > B.h / 2 + A.h / 2) return 0;
      if ((side === 'left' && l.x > 0) || (side === 'right' && l.x < 0)) return 0;
      const spec = groupSpec(A.typeId, B.typeId) || {};
      const g = r.range || spec.gap || DEFAULT_RANGE.beside;
      let s = rangeScore(gap(A, B, lim(g, 300)), g);
      // выравнивание по заднему/переднему краю партнёра (тумбы — по изголовью кровати)
      const al = r.align || spec.align;
      if (al === 'back') s *= 1 - lerp01(Math.abs(l.y - (-B.h / 2 + A.h / 2)), 30, 300);
      else if (al === 'front') s *= 1 - lerp01(Math.abs(l.y - (B.h / 2 - A.h / 2)), 30, 300);
      return s;
    },
    around(r, As, env, B) {
      if (!As.length) return 0; let s = 0;
      for (const A of As) { const g = gap(A, B, 501); const f = 1 - lerp01(angBetween(A.fr.front, { x: B.fr.x - A.fr.x, y: B.fr.y - A.fr.y }), 30, 70); s += (1 - lerp01(g, 150, 500)) * f; }
      return s / As.length;
    },
    aligned(r, A, env, B) {
      const d = angDiff(A.fr.rot, B.fr.rot) % 180; if (Math.min(d, 180 - d) > 3) return 0;
      const l = B.fr.l(center(A)); const ax = r.axis || 'center';
      // по центру — центры на общей оси (в ряд вдоль стены или один над/перед другим)
      const dev = ax === 'front' ? Math.abs(l.y + A.h / 2 - B.h / 2) : ax === 'back' ? Math.abs(l.y - A.h / 2 + B.h / 2) : Math.min(Math.abs(l.x), Math.abs(l.y));
      return 1 - lerp01(dev, 20, 200);
    },
    parallel(r, A, env, B) { const d = angDiff(A.fr.rot, B.fr.rot) % 180; return 1 - lerp01(Math.min(d, 180 - d), 3, 15); },
    perpendicular(r, A, env, B) { const d = angDiff(A.fr.rot, B.fr.rot) % 180; return 1 - lerp01(Math.abs(d - 90), 3, 15); },
    same_wall(r, A, env, B) { const a = backWall(A, env.room), b = backWall(B, env.room); return a && b && a.wall.id === b.wall.id ? 1 : 0; },
    distance(r, A, env, B) { const rg = r.range || DEFAULT_RANGE.distance; return rangeScore(gap(A, B, lim(rg, 500)), rg, 500); },
    on_top_of(r, A, env, B) { return A.item.baseId === B.id ? 1 : 0; },
    under(r, A, env, B) { return 1 - lerp01(gap(A, B, 501), 0, 500); },
    in_region(r, A, env) { const g = regionOf(env.room, r.region); if (!g) return 0; return G.pointInPoly(center(A), g.poly) ? 1 : 1 - lerp01(ptPolyDist(center(A), g.poly), 0, 1000); },
    keep_clear(r, _A, env) {
      const poly = r.rect ? [{ x: r.rect[0], y: r.rect[1] }, { x: r.rect[2], y: r.rect[1] }, { x: r.rect[2], y: r.rect[3] }, { x: r.rect[0], y: r.rect[3] }] : (regionOf(env.room, r.region) || {}).poly;
      if (!poly) return 0; const bb = G.aabbOf(poly); let n = 0, hit = 0;
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { const p = { x: bb.x0 + (i + 0.5) * bb.w / 6, y: bb.y0 + (j + 0.5) * bb.h / 6 }; if (!G.pointInPoly(p, poly)) continue; n++; if (env.all.some(D => D.solid && !D.outside && D.mount === 'floor' && G.pointInPoly(p, D.poly))) hit++; }
      return n ? 1 - hit / n : 1;
    },
    symmetric(r, A, env, B, C) { if (!C) return 0; const la = C.fr.l(center(A)), lb = C.fr.l(center(B)); return 1 - lerp01(Math.abs(la.x + lb.x) + Math.abs(la.y - lb.y), 30, 300); },
  };
  const NEEDS_B = new Set(['facing', 'opposite', 'in_front_of', 'beside', 'around', 'aligned', 'parallel', 'perpendicular', 'same_wall', 'distance', 'on_top_of', 'under', 'symmetric']);

  /* Оценка одного отношения: число 0–1 или null, если участников нет в расстановке (не применимо) */
  function score(r, env) {
    const fn = SCORE[r.rel]; if (!fn) return null;
    if (r.rel === 'keep_clear') return fn(r, null, env);
    const B = r.b ? env.get(r.b) : null; if (NEEDS_B.has(r.rel) && !B) return null;
    if (r.rel === 'around') { const As = (Array.isArray(r.a) ? r.a : [r.a]).map(id => env.get(id)).filter(Boolean); return fn(r, As, env, B); }
    const ids = Array.isArray(r.a) ? r.a : [r.a]; const As = ids.map(id => env.get(id)).filter(Boolean); if (!As.length) return null;
    const C = r.c ? env.get(r.c) : null;
    let s = 0; for (const A of As) { if (!A.fr) return 0; s += fn(r, A, env, B, C); } return s / As.length;
  }
  /* М11 / М12: взвешенное выполнение. Отношение с отсутствующим участником (не поместившееся добавление) = 0 */
  function scoreAll(rels, env, opts = {}) {
    if (!rels || !rels.length) return null;
    let sw = 0, s = 0, done = 0; const items = [];
    for (const r of rels) {
      const w = KP.PRIORITY_WEIGHT[r.prio || 'should'] || 2; let v = score(r, env); if (v == null) v = opts.missingAs ?? 0;
      sw += w; s += w * v; if (v >= 0.8) done++; items.push({ id: r.id, rel: r.rel, s: +v.toFixed(3) });
    }
    return { s: sw ? s / sw : 1, done, n: rels.length, items };
  }
  function mkEnv(room, descs) { const m = new Map(descs.map(D => [D.id, D])); return { room, get: (id) => m.get(id), all: descs }; }

  /* ---------- Где отношение хочет предмет (фильтры солвера, лестница ослаблений §19.4) ---------- */
  function where(r, env) {
    switch (r.rel) {
      case 'against_wall': case 'centered_on_wall': { const ws = walls(env, r.wall); return { walls: ws ? new Set(ws.map(w => w.id)) : null, wallOnly: true }; }
      case 'under_window': return { walls: new Set(env.room.walls.filter(w => w.hasWindow).map(w => w.id)), wallOnly: true };
      case 'in_corner': return { corner: r.corner || '*' };
      case 'in_region': return { region: r.region };
      case 'same_wall': { const B = env.get(r.b); const bw = B && B.fr && backWall(B, env.room); return bw ? { walls: new Set([bw.wall.id]), wallOnly: true } : null; }
      default: return null;
    }
  }
  /* Вовлечённые предметы отношения */
  const members = (r) => [...(Array.isArray(r.a) ? r.a : [r.a]), r.b, r.c].filter(Boolean);

  /* ---------- Кандидатные позы от партнёра (ТЗ §19.2) ----------
     shape = {w, h} — локальный габарит ставящегося предмета. Возвращает [{x, y, rot, tag}] центров (напольные). */
  function propose(r, aId, shape, env) {
    const out = []; const B = r.b ? env.get(r.b) : null; if (!B || !B.fr) return out;
    const add = (lx, ly, rot, tag, base = B) => { const p = base.fr.w(lx, ly); out.push({ x: p.x, y: p.y, rot: norm360(rot), tag }); };
    const rng = (def) => r.range || (groupSpec(shape.typeId, B.typeId) || {})[def] || DEFAULT_RANGE[r.rel] || [0, 300];
    switch (r.rel) {
      case 'in_front_of': case 'opposite': {
        const [a, b] = rng('range'); const ds = [...new Set([a, (a + b) / 2, b].map(Math.round))];
        for (const d of ds) { add(0, B.h / 2 + d + shape.h / 2, B.fr.rot + 180, r.rel + ':' + d); if (r.rel === 'in_front_of') add(0, B.h / 2 + d + shape.h / 2, B.fr.rot, r.rel + ':' + d + ':same'); }
        break;
      }
      case 'beside': {
        const [a, b] = rng('gap'); const sides = r.side === 'left' ? [-1] : r.side === 'right' ? [1] : [-1, 1];
        for (const sx of sides) for (const g of [...new Set([a, (a + b) / 2].map(Math.round))]) {
          const lx = sx * (B.w / 2 + g + shape.w / 2);
          add(lx, -B.h / 2 + shape.h / 2, B.fr.rot, 'beside:back');
          add(lx, B.h / 2 - shape.h / 2, B.fr.rot, 'beside:front');
          // лицом внутрь (кресла у дивана): перед смотрит к оси B
          const inward = { x: -sx * B.fr.right.x, y: -sx * B.fr.right.y };
          const lx2 = sx * (B.w / 2 + g + shape.h / 2);
          add(lx2, B.h / 2 + shape.w / 2, rotFacing(inward), 'beside:inward');
        }
        break;
      }
      case 'around': {
        const gap = 50; const slots = seatSlots(B, shape, gap);
        for (const s of slots) out.push(s);
        break;
      }
      case 'symmetric': {
        const C = r.c ? env.get(r.c) : null; if (!C || !C.fr) break;
        const lb = C.fr.l({ x: B.fr.x, y: B.fr.y }); const p = C.fr.w(-lb.x, lb.y);
        const fl = { x: B.fr.front.x, y: B.fr.front.y }; const lf = C.fr.l({ x: C.fr.x + fl.x, y: C.fr.y + fl.y }); const wf = C.fr.w(-lf.x, lf.y);
        out.push({ x: p.x, y: p.y, rot: norm360(rotFacing({ x: wf.x - C.fr.x, y: wf.y - C.fr.y })), tag: 'symmetric' });
        break;
      }
      case 'under': {
        const ly = B.typeId === 'bed' || B.typeId === 'kids-bed' ? B.h / 6 : B.h / 2; add(0, ly, B.fr.rot, 'under');
        break;
      }
      case 'aligned': case 'same_wall': case 'parallel': case 'perpendicular': case 'distance': case 'facing': break;
      default: break;
    }
    return out;
  }
  /* Места для стульев вокруг стола: по 600 мм края на место; стороны у стены пропускаются */
  function seatSlots(B, shape, gap = 50) {
    const out = []; const face = (p) => norm360(rotFacing({ x: B.fr.x - p.x, y: B.fr.y - p.y }));
    if (B.fp === 'circle' || B.fp === 'ellipse') {
      const a = B.w / 2, b = B.h / 2; const per = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))); const n = Math.max(1, Math.floor(per / 600));
      for (let i = 0; i < n; i++) { const t = (i / n) * 2 * Math.PI + Math.PI / 2; const lx = (a + gap + shape.h / 2) * Math.cos(t), ly = (b + gap + shape.h / 2) * Math.sin(t); const p = B.fr.w(lx, ly); out.push({ x: p.x, y: p.y, rot: face(p), tag: 'seat:' + i }); }
      return out;
    }
    const sides = [['front', B.w, (u) => [u, B.h / 2 + gap + shape.h / 2]], ['back', B.w, (u) => [u, -B.h / 2 - gap - shape.h / 2]], ['left', B.h, (u) => [-B.w / 2 - gap - shape.h / 2, u]], ['right', B.h, (u) => [B.w / 2 + gap + shape.h / 2, u]]];
    for (const [side, len, pos] of sides) {
      const z = B.zones.find(q => q.around && q.side === side); if (z && z.ignored) continue;
      const n = Math.floor(len / 600); for (let i = 0; i < n; i++) { const u = -len / 2 + (i + 0.5) * len / n; const [lx, ly] = pos(u); const p = B.fr.w(lx, ly); out.push({ x: p.x, y: p.y, rot: face(p), tag: `seat:${side}:${i}` }); }
    }
    return out;
  }
  /* Поворот «лицом к» для свободной позиции (отношение facing) */
  function facingRot(r, pos, env) { const B = r.b ? env.get(r.b) : null; if (!B || !B.fr) return null; return norm360(rotFacing({ x: B.fr.x - pos.x, y: B.fr.y - pos.y })); }

  return { VERSION, SCORE, score, scoreAll, mkEnv, where, members, propose, facingRot, seatSlots, rotFacing, rangeScore, freeSegments, windows, groupSpec };
});
