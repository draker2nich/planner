/* Кандидаты товаров для позиции (ТЗ §17.1, §17.3). В И1 — жёсткий фильтр и простая оценка по размеру и цене;
   стиль, цвет, материалы и похожесть на фото (§17.4–17.5) подключаются в И2 через opts.scoreProduct. */
'use strict';
const G = require('../../../public/shared/geometry.js');
const CT = require('../../../public/shared/catalog-types.js');
const AR = require('../../../public/shared/ai-rules.js');

function footprint(p) { const fo = CT.formOf(CT.TYPE.get(p.typeId), p.formId); const l = G.fpPoly(fo.fp, p.dims); return { w: l.w, h: l.h, area: l.w * l.h }; }

/* Жёсткий фильтр: тип, форма, ограничения, цена, высота потолка. Возвращает {list, reasons} */
function hardFilter(job, catalog, room) {
  const reasons = { type: 0, form: 0, constraints: 0, price: 0, ceiling: 0 }; const list = [];
  const orig = job.orig;
  for (const p of catalog) {
    if (p.typeId !== job.typeId) continue;
    if (!(p.price > 0)) { reasons.price++; continue; }
    if (!job.formAny && p.formId !== job.formId) { reasons.form++; continue; }
    const fake = { id: job.id, typeId: p.typeId, formId: p.formId, dims: p.dims, name: job.name };
    if (AR.productCheck(fake, orig && { ...orig, formId: job.formId, formAny: job.formAny, constraints: job.constraints, productId: null }, p)) { reasons.constraints++; continue; }
    const H = p.dims.H || 0;
    const mount = G.mountOf(CT.TYPE.get(p.typeId), CT.formOf(CT.TYPE.get(p.typeId), p.formId));
    const top = mount === 'wall' ? (job.fixedElev != null ? job.fixedElev : 0) + H : H;
    if (top > room.height - (mount === 'wall' ? 0 : 20) ||(p.typeId === 'kids-bed' && p.formId === 'bunk' && room.height - H < 600)) { reasons.ceiling++; continue; }
    list.push(p);
  }
  return { list, reasons };
}

/* Оценка товара 0–1 (И1): текущий товар = 1; иначе близость габарита к исходному и цены к целевой */
function rankProducts(job, list, opts = {}) {
  const ref = job.refDims ? footprint({ typeId: job.typeId, formId: job.formId, dims: job.refDims }) : null;
  const scored = list.map(p => {
    let s;
    if (p.id === job.currentProductId) s = 1;
    else {
      const fp = footprint(p); const sz = ref ? 1 - Math.min(1, Math.abs(Math.log(fp.area / ref.area)) / Math.log(2)) * 0.6 : 0.7;
      const pr = opts.targetPrice ? 1 - Math.min(1, Math.abs(Math.log(p.price / opts.targetPrice)) / Math.log(3)) : 0.5;
      s = 0.6 * sz + 0.4 * pr; if (opts.scoreProduct) s = 0.5 * s + 0.5 * opts.scoreProduct(p, job);
      s = Math.min(0.95, s);
    }
    return { p, s, fp: footprint(p) };
  });
  scored.sort((a, b) => b.s - a.s || a.p.price - b.p.price || (a.p.id < b.p.id ? -1 : 1));
  return scored;
}

/* 5 лучших + самый дешёвый + самый компактный + один заметно другой (ТЗ §17.3 п. 4) */
function pickCandidates(ranked, n = 5) {
  if (ranked.length <= n + 3) return ranked.slice();
  const out = ranked.slice(0, n); const has = new Set(out.map(x => x.p.id));
  const push = (x) => { if (x && !has.has(x.p.id)) { out.push(x); has.add(x.p.id); } };
  push(ranked.reduce((a, b) => (b.p.price < a.p.price ? b : a)));
  push(ranked.reduce((a, b) => (b.fp.area < a.fp.area ? b : a)));
  const ref = ranked[0].fp.area; push(ranked.filter(x => !has.has(x.p.id)).reduce((a, b) => (!a || Math.abs(Math.log(b.fp.area / ref)) > Math.abs(Math.log(a.fp.area / ref)) ? b : a), null));
  return out;
}

module.exports = { hardFilter, rankProducts, pickCandidates, footprint };
