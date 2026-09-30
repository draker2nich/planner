/* Картинка решения для отладки и отчётов ai:eval: план комнаты, проёмы, предметы, жёсткие зоны. */
'use strict';
const AR = require('../../../public/shared/ai-rules.js');
const CT = require('../../../public/shared/catalog-types.js');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pts = (P, k, ox, oy) => P.map(p => `${((p.x - ox) * k).toFixed(1)},${((p.y - oy) * k).toFixed(1)}`).join(' ');

function renderSVG(room, furniture, opts = {}) {
  const bb = room.bbox; const pad = 400; const width = opts.width || 720;
  const k = width / (bb.w + 2 * pad); const H = (bb.h + 2 * pad) * k + 36; const ox = bb.x0 - pad, oy = bb.y0 - pad;
  const orig = new Map((opts.original || []).map(f => [f.id, f]));
  const ctx = AR.mkCtx(room, furniture, { productById: opts.productById });
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H.toFixed(0)}" viewBox="0 0 ${width} ${H.toFixed(0)}" font-family="sans-serif">`, `<rect width="100%" height="100%" fill="#fff"/>`];
  out.push(`<g transform="translate(0,36)">`);
  out.push(`<polygon points="${pts(room.poly, k, ox, oy)}" fill="#f6f4ef" stroke="#333" stroke-width="3"/>`);
  for (const g of room.regions) if (room.regions.length > 1) out.push(`<polygon points="${pts(g.poly, k, ox, oy)}" fill="none" stroke="#bbb" stroke-dasharray="4 4"/>`);
  for (const w of room.walls) {
    const m = w.point(w.len / 2, -220); out.push(`<text x="${((m.x - ox) * k).toFixed(1)}" y="${((m.y - oy) * k).toFixed(1)}" font-size="11" fill="#999" text-anchor="middle">${w.label}</text>`);
    for (const o of w.openings) { const a = w.point(o.t0), b = w.point(o.t1); const col = o.kind === 'window' ? '#3b82f6' : o.kind === 'door' ? '#a16207' : '#6b7280'; out.push(`<line x1="${((a.x - ox) * k).toFixed(1)}" y1="${((a.y - oy) * k).toFixed(1)}" x2="${((b.x - ox) * k).toFixed(1)}" y2="${((b.y - oy) * k).toFixed(1)}" stroke="${col}" stroke-width="6"/>`); }
  }
  for (const z of room.zones.doorSwing) out.push(`<polygon points="${pts(z.pts, k, ox, oy)}" fill="#a1620718" stroke="#a16207" stroke-dasharray="3 3"/>`);
  for (const z of room.zones.entry) out.push(`<polygon points="${pts(z.pts, k, ox, oy)}" fill="#a1620710" stroke="none"/>`);
  const descs = furniture.map(f => AR.describe(f, room, ctx)).filter(D => D && !D.invalid);
  const layer = (D) => (D.mount === 'ceiling' ? 4 : D.mount === 'wall' ? 3 : D.mount === 'ontop' ? 2 : D.isRug ? 0 : 1);
  descs.sort((a, b) => layer(a) - layer(b));
  for (const D of descs) {
    if (opts.zones !== false) for (const z of D.zones) if (z.hardPts && !z.ignored) out.push(`<polygon points="${pts(z.hardPts, k, ox, oy)}" fill="none" stroke="#10b98166" stroke-dasharray="2 3"/>`);
  }
  for (const D of descs) {
    const o = orig.get(D.id); const f = D.item;
    const moved = o && (Math.hypot((o.x || 0) - (f.x || 0), (o.y || 0) - (f.y || 0)) > 1 || (o.offset || 0) !== (f.offset || 0) || o.wallId !== f.wallId);
    const col = !o ? '#16a34a' : (o.productId !== f.productId ? '#7c3aed' : moved ? '#2563eb' : '#6b7280');
    const fill = D.isRug ? '#fde68a55' : D.mount === 'wall' ? col + '55' : D.mount === 'ceiling' ? 'none' : col + '26';
    out.push(`<polygon points="${pts(D.poly, k, ox, oy)}" fill="${fill}" stroke="${col}" stroke-width="${D.mount === 'wall' ? 1 : 1.6}"${D.mount === 'ceiling' ? ' stroke-dasharray="5 3"' : ''}/>`);
    if (D.mount === 'floor' && !D.isRug) { const a = D.fr.w(0, D.h / 2 - Math.min(80, D.h / 4)), b = D.fr.w(0, D.h / 2); out.push(`<line x1="${((a.x - ox) * k).toFixed(1)}" y1="${((a.y - oy) * k).toFixed(1)}" x2="${((b.x - ox) * k).toFixed(1)}" y2="${((b.y - oy) * k).toFixed(1)}" stroke="${col}" stroke-width="2"/>`); }
    const t = CT.TYPE.get(D.typeId); const lab = (t ? t.name : D.typeId).split(/[ ‑/]/)[0];
    if (D.mount !== 'wall' || D.w > 500) out.push(`<text x="${((D.fr.x - ox) * k).toFixed(1)}" y="${((D.fr.y - oy) * k + 4).toFixed(1)}" font-size="${D.w * k > 60 ? 11 : 9}" fill="#111" text-anchor="middle">${esc(lab)}</text>`);
  }
  out.push('</g>');
  if (opts.title) out.push(`<text x="8" y="16" font-size="13" font-weight="bold">${esc(opts.title)}</text>`);
  if (opts.subtitle) out.push(`<text x="8" y="30" font-size="11" fill="#555">${esc(opts.subtitle)}</text>`);
  out.push(`<g font-size="10" transform="translate(${width - 330},12)"><rect width="10" height="10" fill="#6b7280"/><text x="14" y="9">на месте</text><rect x="70" width="10" height="10" fill="#2563eb"/><text x="84" y="9">перемещён</text><rect x="150" width="10" height="10" fill="#7c3aed"/><text x="164" y="9">товар подобран</text><rect x="250" width="10" height="10" fill="#16a34a"/><text x="264" y="9">добавлен</text></g>`);
  out.push('</svg>');
  return out.join('\n');
}
module.exports = { renderSVG };
