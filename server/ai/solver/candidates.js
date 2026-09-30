/* Кандидатные позиции предмета по способу постановки (ТЗ §19.2).
   Позы — в формате редактора: напольные {x, y, rot, mirror}, настенные {wallId, offset, elev}, на основании {baseId, x, y, rot}. */
'use strict';
const G = require('../../../public/shared/geometry.js');
const CT = require('../../../public/shared/catalog-types.js');
const AR = require('../../../public/shared/ai-rules.js');
const REL = require('../../../public/shared/ai-relations.js');
const KP = require('../../../public/shared/ai-knowledge/placement.js');

const r1 = (v) => Math.round(v);
const norm360 = (a) => Math.round((((a % 360) + 360) % 360) * 10) / 10;
function shapeOf(typeId, formId, dims) {
  const t = CT.TYPE.get(typeId), fo = CT.formOf(t, formId); const l = G.fpPoly(fo.fp, dims);
  return { typeId, formId: fo.id, fp: fo.fp, dims, w: l.w, h: l.h, mount: G.mountOf(t, fo) };
}
const CORNER_FORMS = new Set(['L', 'U', 'quarter']);
/* Предметы без «переда»: свободно стоящие столы и ковры достаточно повернуть на 0/90° */
const TWO_WAY = new Set(['table', 'coffee-table', 'rug', 'island', 'meeting-table', 'closet-island', 'small-table', 'toy-house', 'pouf', 'beanbag', 'plant']);

/* Радиаторы на стене: интервалы t и глубина (зазор тылом «глубина радиатора + 100», прил. А.1) */
function radiatorsOn(room, fixedItems) {
  const m = new Map();
  for (const f of fixedItems) if (f.typeId === 'radiator' && f.wallId) { const w = room.W.get(f.wallId); if (!w) continue; const [t0, t1] = w.tOf(f.offset, f.dims.W); (m.get(w.id) || m.set(w.id, []).get(w.id)).push({ t0, t1, depth: f.dims.D || 100 }); }
  return m;
}

/* У стены: пригодные участки с шагом + точки притяжения (углы, центры, края проёмов, attract) */
function wallPoses(room, shape, o = {}) {
  const out = []; const step = o.step || 50; const gap0 = o.gap || 0; const mirrors = shape.fp === 'L' ? (o.mirrors || [false, true]) : [false];
  for (const w of room.walls) {
    if (w.len < 300 || (o.walls && !o.walls.has(w.id)) || shape.w > w.len + 0.5) continue;
    const lo = shape.w / 2, hi = w.len - shape.w / 2; const ts = new Set();
    if (!o.onlyAttract) {
      for (let t = lo; t <= hi + 0.01; t += step) ts.add(r1(t));
      ts.add(r1(hi)); ts.add(r1(w.len / 2));
      for (const op of w.openings) { ts.add(r1(op.t0 - shape.w / 2)); ts.add(r1(op.t1 + shape.w / 2)); ts.add(r1((op.t0 + op.t1) / 2)); }
      for (const [a, b] of REL.freeSegments(w)) { ts.add(r1((a + b) / 2)); ts.add(r1(a + shape.w / 2)); ts.add(r1(b - shape.w / 2)); }
    }
    for (const t of (o.attract && o.attract.get(w.id)) || []) ts.add(r1(Math.max(lo, Math.min(hi, t))));
    const rads = (o.radiators && o.radiators.get(w.id)) || [];
    const rot = norm360(REL.rotFacing(w.n));
    for (const t of [...ts].sort((a, b) => a - b)) {
      if (t < lo - 0.5 || t > hi + 0.5) continue;
      let gap = gap0; for (const r of rads) if (Math.min(t + shape.w / 2, r.t1) - Math.max(t - shape.w / 2, r.t0) > 0) gap = Math.max(gap, r.depth + AR.RADIATOR.near);
      const c = w.point(t, gap + shape.h / 2);
      for (const mirror of mirrors) out.push({ x: c.x, y: c.y, rot, mirror, wallId: w.id, t, gap, tag: 'wall' });
    }
  }
  return out;
}

/* В углу: угловые формы — только во внутренние углы 88–92° (ТЗ §13.3); прочие — тылом к одной стене у угла */
function cornerPoses(room, shape, o = {}) {
  const out = []; const tol = o.cornerTol ?? 2;
  for (const c of room.corners) {
    if (!c.inner) continue;
    const wp = room.W.get(c.prevWall), wn = room.W.get(c.nextWall); const V = { x: c.x, y: c.y };
    if (CORNER_FORMS.has(shape.fp)) {
      if (shape.fp === 'U' || Math.abs(c.angle - 90) > tol) continue;
      const opts = shape.fp === 'quarter' ? [{ front: wn.n, right: wn.u }] : [{ front: wn.n, right: { x: -wn.u.x, y: -wn.u.y } }, { front: wp.n, right: wp.u }];
      for (const op of opts) {
        const rot = norm360(REL.rotFacing(op.front)); const fr = AR.mkFrame({ x: 0, y: 0, rot, mirror: false });
        const mirror = fr.right.x * op.right.x + fr.right.y * op.right.y < 0;
        if (o.mirrors && !o.mirrors.includes(mirror)) continue;
        const pose = AR.poseFromAnchor({ kind: 'corner', x: V.x, y: V.y, rot, mirror }, shape.typeId, shape.formId, shape.dims);
        out.push({ x: pose.x, y: pose.y, rot, mirror, corner: c.id, tag: 'corner' });
      }
    } else if (shape.fp === 'circle' || shape.fp === 'ellipse' || shape.fp === 'square') {
      const d1 = wn.u, d2 = { x: -wp.u.x, y: -wp.u.y }; const bl = Math.hypot(d1.x + d2.x, d1.y + d2.y) || 1; const bis = { x: (d1.x + d2.x) / bl, y: (d1.y + d2.y) / bl };
      const half = Math.max(shape.w, shape.h) / 2 + 50; const d = half / Math.sin(c.angle * Math.PI / 360);
      out.push({ x: V.x + bis.x * d, y: V.y + bis.y * d, rot: norm360(REL.rotFacing(bis)), mirror: false, corner: c.id, tag: 'corner' });
    } else {
      const gap = o.gap || 0;
      if (wn.len >= shape.w) { const p = wn.point(shape.w / 2, gap + shape.h / 2); out.push({ x: p.x, y: p.y, rot: norm360(REL.rotFacing(wn.n)), mirror: false, wallId: wn.id, t: shape.w / 2, gap, corner: c.id, tag: 'corner' }); }
      if (wp.len >= shape.w) { const p = wp.point(wp.len - shape.w / 2, gap + shape.h / 2); out.push({ x: p.x, y: p.y, rot: norm360(REL.rotFacing(wp.n)), mirror: false, wallId: wp.id, t: wp.len - shape.w / 2, gap, corner: c.id, tag: 'corner' }); }
    }
  }
  return out;
}

/* Свободно: сетка по областям + центры областей; повороты — по главным осям комнаты */
function freePoses(room, shape, o = {}) {
  const out = []; const regs = o.region ? room.regions.filter(r => r.id === o.region) : room.regions;
  const axes = room.axes.slice(0, 2).map(a => a.angle); if (!axes.length) axes.push(0);
  const k = shape.fp === 'circle' ? [0] : TWO_WAY.has(shape.typeId) ? [0, 90] : [0, 90, 180, 270];
  const rots = [...new Set(axes.flatMap(a => k.map(d => norm360(a + d))))].concat(o.rots || []);
  for (const g of regs) {
    const bb = G.aabbOf(g.poly); const step = o.step || Math.max(100, Math.ceil(Math.min(Math.sqrt(g.area / (o.maxPoints || 160)), Math.max(shape.w, shape.h, 400)) / 50) * 50);
    const m = Math.min(shape.w, shape.h) / 2; const pts = [{ x: r1(g.center.x), y: r1(g.center.y) }];
    for (let x = bb.x0 + m; x <= bb.x1 - m + 0.01; x += step) for (let y = bb.y0 + m; y <= bb.y1 - m + 0.01; y += step) { const p = { x: r1(x), y: r1(y) }; if (G.pointInPoly(p, g.poly)) pts.push(p); }
    for (const p of pts) for (const rot of rots) out.push({ x: p.x, y: p.y, rot, mirror: false, region: g.id, tag: 'free' });
  }
  return out;
}

/* Высоты установки настенного (прил. А.4): низ предмета, мм */
function elevationsOf(shape) {
  const sp = KP.spec(shape.typeId); const e = sp.elevation; const H = shape.dims.H || 0;
  if (!e) return [shape.dims.E ?? 0];
  const vals = [e.def ?? (e.min + e.max) / 2, e.min, e.max];
  return [...new Set(vals.map(v => r1(e.ref === 'center' ? v - H / 2 : v)))];
}
/* На стене: как «у стены», шаг крупнее, высоты из elevation; attract — центры предметов у этой стены */
function mountPoses(room, shape, o = {}) {
  const out = []; const W = shape.dims.W; const step = o.step || 100; const elevs = o.elevs || elevationsOf(shape);
  for (const w of room.walls) {
    if (w.len < 300 || (o.walls && !o.walls.has(w.id)) || W > w.len + 0.5) continue;
    const lo = W / 2, hi = w.len - W / 2; const ts = new Set();
    if (!o.onlyAttract) { for (let t = lo; t <= hi + 0.01; t += step) ts.add(r1(t)); ts.add(r1(hi)); ts.add(r1(w.len / 2)); for (const [a, b] of REL.freeSegments(w)) ts.add(r1((a + b) / 2)); }
    for (const t of (o.attract && o.attract.get(w.id)) || []) ts.add(r1(Math.max(lo, Math.min(hi, t))));
    for (const t of [...ts].sort((a, b) => a - b)) {
      if (t < lo - 0.5 || t > hi + 0.5) continue;
      for (const elev of (o.elevAt ? o.elevAt(w, t) || elevs : elevs)) out.push({ wallId: w.id, offset: r1(w.offsetOf(t - W / 2, W)), elev: r1(elev), t, tag: 'mount' });
    }
  }
  return out;
}

/* На основании: по центру и у заднего края каждого подходящего основания */
function ontopPoses(shape, bases) {
  const out = [];
  for (const B of bases) {
    if (!B.fr || shape.w > B.w + 1 || shape.h > B.h + 1) continue;
    out.push({ baseId: B.id, x: B.fr.x, y: B.fr.y, rot: norm360(B.fr.rot), mirror: false, tag: 'ontop:center' });
    const p = B.fr.w(0, -B.h / 2 + shape.h / 2 + 10); out.push({ baseId: B.id, x: p.x, y: p.y, rot: norm360(B.fr.rot), mirror: false, tag: 'ontop:back' });
  }
  return out;
}

module.exports = { shapeOf, wallPoses, cornerPoses, freePoses, mountPoses, ontopPoses, elevationsOf, radiatorsOn, CORNER_FORMS, TWO_WAY, norm360 };
