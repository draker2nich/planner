/* =====================================================================
   Солвер расстановки (ТЗ §19): замысел → позы и товары, все жёсткие правила соблюдены.
   Чистый JS на общем коде (geometry.js, ai-room.js, ai-rules.js, ai-relations.js), без сети и без модели.
   Одинаковый вход + одинаковое зерно = одинаковый результат (§19.6).

     const prep = prepare(project, catalog, task, limits);   // общее для всех замыслов запуска
     const res  = solveConcept(prep, concept, { seed });     // до 3 решений + диагностика
   ===================================================================== */
'use strict';
const G = require('../../../public/shared/geometry.js');
const CT = require('../../../public/shared/catalog-types.js');
const R = require('../../../public/shared/ai-room.js');
const AR = require('../../../public/shared/ai-rules.js');
const REL = require('../../../public/shared/ai-relations.js');
const KF = require('../../../public/shared/ai-knowledge/furniture.js');
const KP = require('../../../public/shared/ai-knowledge/placement.js');
const C = require('./candidates.js');
const PR = require('./products.js');
const { rng, hashSeed } = require('./rng.js');

const VERSION = 'solver-1';
/* Настройки (ТЗ §19.3, §19.6, §29.3): меняются без правки алгоритма */
const DEFAULTS = {
  beam: 24, branch: 12, sameFirst: 4, maxExpansions: 6000, timeMs: 10000, solutions: 3,
  wallStep: 'auto', mountStep: 100, freeMaxPoints: 160, products: 5, improveTrials: 16, maxStage: 5, accessPages: 4, accessCells: Infinity,
};
/* Настенные предметы, которые ИИ может перемещать (прил. А.4) */
const WALL_MOVABLE = new Set(['tv', 'mirror', 'picture', 'wall-shelf', 'sconce', 'coat-rack', 'drying-rack', 'screen']);
const W = { rel: 1, zone: 1.2, prod: 0.6, hint: 1.5, stay: 0.3, stayUser: 2, neat: 0.3, intrude: 0.6, look: 4 };
const clone = (x) => JSON.parse(JSON.stringify(x));
const round1 = (v) => Math.round(v);

/* ---------- Подготовка: общее для всех замыслов ---------- */
function prepare(project, catalog, task = {}, limits = {}) {
  const L = { ...DEFAULTS, ...limits };
  const room = R.buildRoom(project);
  // шаг вдоль стен: 50 мм (ТЗ §19.2), в больших комнатах — 100 мм (§29.3: настройка вместо правки алгоритма)
  if (L.wallStep === 'auto') L.wallStep = room.walls.reduce((s, w) => s + w.len, 0) <= 24000 ? 50 : 100;
  const cat = new Map(catalog.map(p => [p.id, p]));
  const productById = (id) => cat.get(id) || null;
  const orig = clone(project.furniture || []);
  const origById = new Map(orig.map(f => [f.id, f]));
  const ctx0 = AR.mkCtx(room, orig, { productById });
  const origDesc = new Map(); for (const f of orig) { const D = AR.describe(f, room, ctx0); if (D) origDesc.set(f.id, D); }

  const info = new Map();
  for (const f of orig) {
    const t = CT.TYPE.get(f.typeId); const fo = CT.formOf(t, f.formId); const mount = G.mountOf(t, fo);
    const pol = AR.policyOf(f); const category = KF.categoryOf(f.typeId);
    const canMove = mount === 'floor' || mount === 'ontop' || (mount === 'wall' && WALL_MOVABLE.has(f.typeId));
    info.set(f.id, { f, mount, pol, moves: (pol === 'move' || pol === 'free') && canMove, picks: (pol === 'replace' || pol === 'free') && category !== 'infra' });
  }
  const fixed = [], jobs = [];
  for (const f of orig) {
    const I = info.get(f.id); const D = origDesc.get(f.id);
    const bI = f.baseId ? info.get(f.baseId) : null;
    const rides = I.mount === 'ontop' && !I.moves && !!bI && (bI.moves || bI.picks);
    if (!I.moves && !I.picks && !rides) { fixed.push(f); continue; }
    const base = rides ? origById.get(f.baseId) : null;
    jobs.push({
      id: f.id, orig: f, name: f.name, typeId: f.typeId, formId: f.formId, formAny: !f.productId && !!f.formAny, constraints: f.constraints || {},
      currentProductId: f.productId, placeholder: !f.productId, moves: I.moves, picks: I.picks, rides, mount: I.mount,
      anchor: !I.moves && !rides && D && !D.invalid ? AR.anchorOf(D, room) : null,
      relBase: rides && base ? relPose(f, base) : null, fixedElev: I.mount === 'wall' && !I.moves ? (f.elev ?? f.dims.E ?? 0) : null,
      rank: KP.rankOf(f.typeId) || 3, area: D && D.area ? D.area : 0, required: true, added: false, refDims: f.dims, outside: !!(D && D.outside),
    });
  }
  // неподвижные: препятствия (предмет «Ничего не делать» целиком за стеной не учитывается, ТЗ §26 п. 7)
  const fixedDescs = fixed.map(f => origDesc.get(f.id)).filter(D => D && !D.invalid && !D.outside).map(withBBZ);
  const fixedById = new Map(fixedDescs.map(D => [D.id, D]));
  const fixedBlocked = new Map();
  const fixedBlockers = new Map();
  for (const A of fixedDescs) { const s = new Set(), m = new Map(); for (const B of fixedDescs) for (const k of AR.blocksZones(A, B)) { s.add(k); (m.get(k) || m.set(k, []).get(k)).push(B.id); } fixedBlocked.set(A.id, s); fixedBlockers.set(A.id, m); }
  const origViolations = AR.fixedViolations(project, { room, productById });
  const origKeys = new Set(origViolations.map(AR.vkey));
  // быстрая проверка доступности в поиске — на сетке 100 мм для больших комнат (итоговая проверка — на 50 мм)
  const fine = AR.gridOf(room); const accessGrid = fine.nx * fine.ny > L.accessCells ? R.makeGrid({ ...room, cell: 100 }) : fine;
  const passBase = AR.baseBlocked(room, fixedDescs, accessGrid);
  const baseAccess = new Set(AR.accessCheck(room, fixedDescs, AR.passInfo(room, fixedDescs, { base: passBase, grid: accessGrid })).map(v => v.rule + '|' + v.ids.join(',')));
  // бюджет (ТЗ §12): F — неизменяемая стоимость
  const F = orig.filter(f => { const I = info.get(f.id); return f.productId && !I.picks; }).reduce((s, f) => s + Math.max(0, (productById(f.productId) || {}).price || 0), 0);   // цена ≤ 0 не входит (§12.1)
  const b = task.budget || { mode: 'none' };
  const limit = b.mode === 'strict' ? b.amount : b.mode === 'over' ? b.amount * (1 + (b.overPct || 0) / 100) : b.mode === 'target' ? null : Infinity;
  const prep = {
    L, room, project: clone(project), catalog, productById, orig, origById, origDesc, fixed, fixedDescs, fixedById, fixedBlocked, fixedBlockers, jobs,
    origViolations, origKeys, baseAccess, passBase, accessGrid, task, budget: { ...b, F, limit }, radiators: C.radiatorsOn(room, fixed), cache: new Map(), stats: { described: 0 },
  };
  for (const j of jobs) initProducts(prep, j);
  if (b.mode === 'target') { const reserve = jobs.filter(j => j.picks).reduce((s, j) => s + minPrice(j), 0); prep.budget.limit = Math.max(1.5 * b.amount, F + reserve); }
  return prep;
}
function relPose(f, base) { const fb = AR.mkFrame(base); const l = fb.l(f); return { x: l.x, y: l.y, rot: f.rot - base.rot }; }
function minPrice(j) { return j.products.all.length ? Math.min(...j.products.all.map(e => e.p.price || 0)) : 0; }

/* Товары позиции: при праве выбора — кандидаты каталога, иначе текущий товар (или размеры пустышки) */
function initProducts(prep, job) {
  if (!job.picks) {
    const p = job.currentProductId && prep.productById(job.currentProductId);
    const entry = { p: p || { id: job.currentProductId, typeId: job.typeId, formId: job.formId, dims: job.orig.dims, price: 0, missing: true }, s: 1 };
    entry.p = { ...entry.p, dims: { ...job.orig.dims } };   // размеры предмета в проекте главнее (move: товар не меняется)
    job.products = { all: [entry], cand: [entry], reasons: null }; return;
  }
  const origMount = job.mount;
  const f = PR.hardFilter(job, prep.catalog, prep.room);
  const list = f.list.filter(p => G.mountOf(CT.TYPE.get(p.typeId), CT.formOf(CT.TYPE.get(p.typeId), p.formId)) === origMount);
  const ranked = PR.rankProducts(job, list, { targetPrice: null });
  job.products = { all: ranked, cand: PR.pickCandidates(ranked, prep.L.products), reasons: f.reasons };
}

/* ---------- Замысел → задания, отношения, порядок ---------- */
function conceptJobs(prep, concept, diag) {
  const jobs = prep.jobs.map(j => ({ ...j, stage: 0 }));
  const allow = !!prep.task.allowAdd;
  if (allow && concept.additions) {
    const counts = new Map(); let n = 0;
    const freeArea = prep.room.area - prep.fixedDescs.filter(D => D.mount === 'floor' && D.solid).reduce((s, D) => s + D.area, 0);
    const lim = Math.min(8, Math.floor(freeArea / 2e6));
    for (const a of concept.additions) {
      const kf = KF.get(a.typeId); const c = (counts.get(a.typeId) || 0) + 1;
      if (!kf || !kf.aiAdd || c > kf.aiAdd || n >= lim) { diag.push({ code: 'ADD_LIMIT', itemId: a.tempId, text: `Добавление ${a.typeId} сверх лимита` }); continue; }
      counts.set(a.typeId, c); n++;
      const t = CT.TYPE.get(a.typeId); const fo = CT.formOf(t, a.formId);
      const orig = { id: a.tempId, typeId: a.typeId, formId: fo.id, productId: null, formAny: !a.formId, name: t.name, constraints: {}, dims: { ...fo.typical }, x: 0, y: 0, rot: 0, mirror: false, locked: false, aiPolicy: 'free', aiAdded: true };
      const job = { id: a.tempId, orig, name: t.name, typeId: a.typeId, formId: fo.id, formAny: !a.formId, constraints: {}, currentProductId: null, placeholder: true, moves: true, picks: true, rides: false, mount: G.mountOf(t, fo), anchor: null, rank: (KP.rankOf(a.typeId) || 3) + 0.5, area: 0, required: false, added: true, reason: a.reason, zone: a.zone, refDims: fo.typical, stage: 0 };
      initProducts(prep, job); jobs.push(job);
    }
  }
  return jobs;
}
function conceptRelations(prep, concept, jobs, diag) {
  const ids = new Set([...prep.orig.map(f => f.id), ...jobs.map(j => j.id)]);
  const rels = []; let k = 0;
  for (const r0 of concept.relations || []) {
    const r = { ...r0, id: r0.id || 'r' + (++k), prio: r0.prio || 'should' };
    if (!REL.SCORE[r.rel]) { diag.push({ code: 'BAD_RELATION', text: `Неизвестное отношение ${r.rel}` }); continue; }
    const mem = REL.members(r); if (mem.some(id => !ids.has(id))) { diag.push({ code: 'BAD_RELATION', text: `Отношение ${r.id}: нет предмета` }); continue; }
    rels.push({ ...r, members: mem });
  }
  // шаблоны групп (ТЗ §14.4): член без отношения к якорю получает отношение «should» к ближайшему якорю
  const all = [...prep.orig, ...jobs.filter(j => j.added).map(j => j.orig)];
  const pos = (f) => (prep.origDesc.get(f.id) && prep.origDesc.get(f.id).fr) || null;
  for (const j of jobs) {
    if (!j.moves) continue;
    const groups = KP.MEMBER_OF[j.typeId] || []; if (!groups.length) continue;
    const linked = rels.some(r => r.members.includes(j.id) && r.members.some(id => id !== j.id && groups.some(g => (all.find(f => f.id === id) || {}).typeId === g.anchor)));
    if (linked) continue;
    const cands = all.filter(f => f.id !== j.id && groups.some(g => g.anchor === f.typeId));
    const hall = (prep.task.purpose || []).includes('hall') || ['shoe-rack', 'coat-rack'].includes(j.typeId);
    const entry = hall && groups.find(g => g.anchor === 'door');
    if (!cands.length) { if (entry) rels.push({ id: 'tpl:' + j.id, rel: 'near_entrance', a: j.id, prio: 'should', template: true, members: [j.id], dist: KP.GROUPS.entry.members[j.typeId].range[1] }); continue; }
    const me = pos(j.orig); const pick = cands.slice().sort((a, b) => { const pa = pos(a), pb = pos(b); const da = me && pa ? Math.hypot(pa.x - me.x, pa.y - me.y) : 0, db = me && pb ? Math.hypot(pb.x - me.x, pb.y - me.y) : 0; return da - db || (a.id < b.id ? -1 : 1); })[0];
    const g = groups.find(x => x.anchor === pick.typeId); const spec = KP.GROUPS[g.group].members[j.typeId];
    const rel = spec.rel === 'near' ? 'distance' : spec.rel;
    if (rel === 'on_top_of' && j.mount !== 'ontop') {   // ТВ на стене над тумбой: та же стена, по центру
      rels.push({ id: 'tpl:' + j.id, rel: 'aligned', axis: 'center', a: j.id, b: pick.id, prio: 'should', template: true, members: [j.id, pick.id] });
      rels.push({ id: 'tpl:w:' + j.id, rel: 'same_wall', a: j.id, b: pick.id, prio: 'should', template: true, members: [j.id, pick.id] });
      continue;
    }
    const r = { id: 'tpl:' + j.id, rel, a: rel === 'around' ? [j.id] : j.id, b: pick.id, prio: 'should', template: true, members: [j.id, pick.id] };
    if (spec.range) r.range = spec.range; if (spec.gap) r.range = spec.gap; if (spec.align) r.align = spec.align;
    rels.push(r);
    if (spec.facing) { const f = all.find(x => x.typeId === spec.facing && x.id !== j.id); if (f) rels.push({ id: 'tpl:f:' + j.id, rel: 'facing', a: j.id, b: f.id, prio: 'nice', template: true, members: [j.id, f.id], maxAngle: 30 }); }
  }
  // пары тумб у кровати — симметрично (шаблон «Спальное место»)
  for (const bed of all.filter(f => f.typeId === 'bed' || f.typeId === 'kids-bed')) {
    const ns = rels.filter(r => r.template && r.b === bed.id && r.rel === 'beside' && (all.find(f => f.id === r.a) || {}).typeId === 'nightstand').map(r => r.a);
    if (ns.length === 2) { rels.push({ id: 'tpl:sym:' + bed.id, rel: 'symmetric', a: ns[1], b: ns[0], c: bed.id, prio: 'nice', template: true, members: [ns[1], ns[0], bed.id] }); for (const r of rels) if (r.template && r.rel === 'beside' && r.a === ns[0]) r.side = 'left'; for (const r of rels) if (r.template && r.rel === 'beside' && r.a === ns[1]) r.side = 'right'; }
  }
  return rels;
}
/* Для локальной оценки «around» с несколькими стульями делится на отношения по одному стулу */
function localRels(rels, id) {
  const out = [];
  for (const r of rels) {
    if (!r.members.includes(id)) continue;
    if (r.rel === 'around' && Array.isArray(r.a) && r.a.length > 1) { if (r.a.includes(id)) out.push({ ...r, a: [id], members: [id, r.b] }); continue; }
    out.push(r);
  }
  return out;
}
function orderJobs(jobs, rels) {
  const grp = (j) => (j.rides || j.mount === 'ontop') ? 2 : j.mount === 'wall' ? 1 : 0;
  const relCount = (j) => rels.filter(r => r.members.includes(j.id)).length;
  const sorted = jobs.slice().sort((a, b) => grp(a) - grp(b) || a.rank - b.rank || relCount(b) - relCount(a) || b.area - a.area || (a.id < b.id ? -1 : 1));
  const byId = new Map(jobs.map(j => [j.id, j])); const deps = new Map();
  // зависимость: едущий — от основания; «рядом с родителем» и младший по рангу — от партнёра отношения
  for (const j of sorted) {
    const d = new Set(); if (j.rides) d.add(j.orig.baseId);
    const first = KP.placementsOf(j.typeId, j.formId)[0];
    for (const r of rels) {
      const subj = Array.isArray(r.a) ? r.a.includes(j.id) : r.a === j.id; if (!subj) continue;
      for (const p of [r.b, r.c]) { const pj = p && byId.get(p); if (!pj || pj === j) continue; if (['near', 'under', 'ontop'].includes(first) || pj.rank < j.rank || grp(j) > grp(pj)) d.add(p); }
    }
    deps.set(j.id, d);
  }
  // группа ставится целиком: члены «рядом с родителем» идут сразу за своим якорем (ТЗ §14.4)
  const first = (j) => KP.placementsOf(j.typeId, j.formId)[0]; const memberOf = new Map();
  for (const r of rels) {
    if (!r.b || !byId.has(r.b) || !['around', 'beside', 'in_front_of', 'under', 'symmetric'].includes(r.rel)) continue;
    for (const id of Array.isArray(r.a) ? r.a : [r.a]) { const m = byId.get(id); if (m && !memberOf.has(id) && m.id !== r.b && grp(m) === 0 && grp(byId.get(r.b)) === 0 && ['near', 'under'].includes(first(m))) memberOf.set(id, r.rel === 'symmetric' && r.c ? r.c : r.b); }
  }
  const seq = [], added = new Set();
  const withMembers = (j) => { if (added.has(j.id)) return; seq.push(j); added.add(j.id); for (const m of sorted) if (memberOf.get(m.id) === j.id) withMembers(m); };
  for (const j of sorted) if (!memberOf.has(j.id) || !byId.has(memberOf.get(j.id))) withMembers(j);
  for (const j of sorted) withMembers(j);
  const out = [], done = new Set(), pending = seq;
  while (pending.length) {
    let i = pending.findIndex(j => [...deps.get(j.id)].every(x => done.has(x) || !byId.has(x)));
    if (i < 0) i = 0;   // цикл зависимостей — берём первого по порядку
    const j = pending.splice(i, 1)[0]; out.push(j); done.add(j.id);
  }
  return out;
}

/* ---------- Кандидаты задания в состоянии ---------- */
function methodsAt(job, formId, stage) {
  const base = KP.placementsOf(job.typeId, formId).filter(m => m !== 'ceiling');
  if (stage < 3) return base.slice(0, 1).concat(base.includes('near') && base[0] !== 'near' ? ['near'] : []);
  const out = base.slice(); if (!out.includes('wall') && !out.includes('wallMount') && !out.includes('ontop') && (out.includes('near') || out.includes('under'))) out.push('wall', 'free');
  if (out.includes('under') && !out.includes('free')) out.push('free');
  return out;
}
function describeItem(prep, item, stateGet) {
  prep.stats.described++;
  return AR.describe(item, prep.room, { itemById: (id) => { const d = stateGet(id); return d ? d.item : prep.origById.get(id); }, productById: prep.productById });
}
function materialize(job, entry, pose) {
  const p = entry.p; const f = { ...job.orig, formId: p.formId || job.formId, productId: p.missing ? job.orig.productId : p.id, dims: { ...p.dims }, formAny: p.missing ? job.orig.formAny : false };
  if (job.picks && !p.missing && p.id !== job.orig.productId) f.name = p.name || f.name;
  delete f.wallId; delete f.offset; delete f.elev; delete f.baseId; delete f.warnings;
  // координаты округляются до 1 мм сразу (ТЗ §13.1): солвер проверяет ровно то, что уйдёт в вариант; поворот — как есть
  if (pose.wallId != null && pose.offset != null) { f.wallId = pose.wallId; f.offset = Math.round(pose.offset); f.elev = Math.round(pose.elev); f.x = job.orig.x; f.y = job.orig.y; f.rot = 0; f.mirror = false; }
  else { f.x = pose.baseId ? pose.x : Math.round(pose.x); f.y = pose.baseId ? pose.y : Math.round(pose.y); f.rot = pose.rot; f.mirror = !!pose.mirror; if (pose.baseId) f.baseId = pose.baseId; }
  return f;
}
/* Статическая проверка: против комнаты и неподвижных (кешируется). Возвращает null или {code, id?}.
   allow — ключи унаследованных нарушений: неподвижному (привязанному к точке) предмету они разрешены (ТЗ §11.8),
   кроме физических (в стене, пересечение, потолок, проём, основание) */
function staticCheck(prep, D, allow) {
  const ok = (v) => allow && !AR.PHYSICAL.has(v.rule) && allow.has(AR.vkey(v));
  for (const v of AR.roomChecks(D, prep.room)) if (!ok(v)) return { code: v.code, id: v.ids[1] };
  if (D.mount === 'ontop') return null;   // основание и соседей проверяет динамическая часть
  const bl = new Set(); const blocksFixed = new Map(); const by = new Map();
  for (const F of prep.fixedDescs) {
    if (!AR.bbOverlap(D.bbZ, F.bbZ)) continue;
    for (const v of AR.pairChecks(D, F)) if (!ok(v)) return { code: v.code, id: F.id };
    for (const k of AR.blocksZones(D, F)) { bl.add(k); (by.get(k) || by.set(k, []).get(k)).push(F.id); }
    const ks = AR.blocksZones(F, D); if (ks.length) blocksFixed.set(F.id, ks);
  }
  const fail = AR.failingZones(D, bl);
  if (fail.length) {
    const ids = [...new Set(fail.flatMap(i => by.get(i) || []))];
    if (!(allow && allow.has(AR.vkey({ rule: 'Ж10', ids: [D.id, ...ids] })))) return { code: 'SERVICE_ZONE', id: ids[0] };
    D.zoneAllowFail = true;
  }
  // неподвижный с уже нарушенной зоной: этот же предмет мешал ей и в исходной расстановке — разрешено
  D.allowFixedFail = new Set();
  for (const [fid, ks] of blocksFixed) {
    const F = prep.fixedById.get(fid); const nb = new Set(prep.fixedBlocked.get(fid)); for (const k of ks) nb.add(k);
    const fz = AR.failingZones(F, nb); if (!fz.some(i => ks.includes(i))) continue;
    const ids = [...new Set(fz.flatMap(i => (prep.fixedBlockers.get(fid).get(i) || [])).concat(D.id))];
    if (allow && allow.has(AR.vkey({ rule: 'Ж10', ids: [fid, ...ids] }))) D.allowFixedFail.add(fid);
    else return { code: 'SERVICE_ZONE', id: fid };
  }
  D.blockedStatic = bl; D.blocksFixed = blocksFixed; return null;
}
function withBBZ(D) {
  if (!D || D.invalid || D.bbZ) return D;
  let { x0, y0, x1, y1 } = D.bb;
  if (D.typeId === 'radiator') { const m = AR.RADIATOR.tall; x0 -= m; y0 -= m; x1 += m; y1 += m; }   // зона перед радиатором (Ж6)
  for (const z of D.zones) { const b = z.softBB || z.hardBB; if (!b) continue; x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
  D.bbZ = { x0, y0, x1, y1 }; return D;
}
function cached(prep, key, make) { let v = prep.cache.get(key); if (v === undefined) { v = make(); prep.cache.set(key, v); } return v; }

/* Фильтры места на ступени лестницы (ТЗ §19.4) */
function filtersOf(prep, job, env, stage, concept) {
  const f = { walls: null, region: null, corner: null, wallOnly: false };
  const prios = stage === 0 ? ['must', 'should', 'nice'] : stage === 1 ? ['must', 'should'] : ['must'];
  const inter = (s) => { f.walls = f.walls ? new Set([...f.walls].filter(x => s.has(x))) : new Set(s); };
  for (const r of job.rels) {
    if (!prios.includes(r.prio) || r.template) continue;
    const subj = Array.isArray(r.a) ? r.a.includes(job.id) : r.a === job.id; if (!subj) continue;
    const w = REL.where(r, env); if (!w) continue;
    if (w.walls) inter(w.walls); if (w.wallOnly) f.wallOnly = true; if (w.region) f.region = w.region; if (w.corner) f.corner = w.corner;
  }
  if (stage <= 1) {
    const h = (concept.hints || []).find(x => x.itemId === job.id) || (job.zone ? { zone: job.zone } : null);
    const z = h && h.zone ? (concept.zones || []).find(x => x.id === h.zone) : null;
    const wall = (h && h.wall) || (z && z.wall), region = (h && h.region) || (z && z.region);
    if (wall) { const ws = R.resolveWall(prep.room, wall, {}); if (ws.length) inter(new Set(ws.map(x => x.id))); }
    if (region && !f.region) f.region = region;
  }
  return f;
}

function gather(prep, job, S, stage, env, concept, reasons) {
  const out = []; const room = prep.room;
  const entries = stage >= 4 ? job.products.all : job.products.cand;
  if (!entries.length) { bump(reasons, job.products.reasons && job.products.reasons.ceiling ? 'CEILING' : job.placeholder ? 'CONSTRAINTS' : 'NO_PRODUCT'); return out; }
  const get = (id) => S.placed.get(id) || prep.fixedById.get(id);
  const filt = filtersOf(prep, job, env, stage, concept);
  const regionPoly = filt.region ? (room.regions.find(r => r.id === filt.region) || {}).poly : null;
  const passRegion = (p) => !regionPoly || G.pointInPoly(p, regionPoly);
  for (const e of entries) {
    const shape = C.shapeOf(job.typeId, e.p.formId || job.formId, e.p.dims);
    const poses = [];
    if (job.rides) {
      const B = get(job.orig.baseId); if (!B || !B.fr) continue; const fb = B.fr; const p = fb.w(job.relBase.x, job.relBase.y);
      poses.push({ x: p.x, y: p.y, rot: C.norm360(fb.rot + job.relBase.rot), mirror: job.orig.mirror, baseId: B.id, tag: 'ride', dyn: true });
    } else if (!job.moves) {
      if (!job.anchor) { bump(reasons, 'OUTSIDE'); continue; }
      if (!AR.handednessOk(e.p, job.anchor.mirror)) continue;   // зеркало угловой формы задано точкой привязки
      poses.push({ ...AR.poseFromAnchor(job.anchor, job.typeId, shape.formId, shape.dims), tag: 'anchor', dyn: true });
    } else {
      const methods = methodsAt(job, shape.formId, stage);
      const mirrors = shape.fp === 'L' && e.p.handedness && e.p.handedness !== 'reversible' ? [e.p.handedness === 'right'] : undefined;
      const statics = (m, make) => cached(prep, `${job.typeId}|${e.p.id}|${m}`, make);
      for (const m of methods) {
        if (filt.wallOnly && !['wall', 'corner', 'wallMount'].includes(m)) continue;
        if (m === 'wall') for (const p of statics('wall', () => C.wallPoses(room, shape, { step: prep.L.wallStep, gap: KP.backGapOf(job.typeId)[0], radiators: prep.radiators, mirrors }))) { if ((!filt.walls || filt.walls.has(p.wallId)) && passRegion(p)) poses.push(p); }
        if (m === 'corner') for (const p of statics('corner', () => C.cornerPoses(room, shape, { mirrors, gap: KP.backGapOf(job.typeId)[0] }))) { if ((!filt.walls || !p.wallId || filt.walls.has(p.wallId)) && (!filt.corner || filt.corner === '*' || filt.corner === p.corner) && passRegion(p)) poses.push(p); }
        if (m === 'free' && !filt.walls) { const fine = stage >= 3; for (const p of statics(fine ? 'free+' : 'free', () => C.freePoses(room, shape, { maxPoints: prep.L.freeMaxPoints * (fine ? 4 : 1) }))) { if (passRegion(p)) poses.push(p); } }
        if (m === 'wallMount') for (const p of statics('mount', () => C.mountPoses(room, shape, { step: prep.L.mountStep }))) { if (!filt.walls || filt.walls.has(p.wallId)) poses.push(p); }
        if (m === 'ontop') { const allowed = (KF.get(job.typeId) || {}).bases || []; const bases = [...S.placed.values(), ...prep.fixedDescs].filter(B => allowed.includes(B.typeId) && B.fr); for (const p of C.ontopPoses(shape, bases)) poses.push({ ...p, dyn: true }); }
        if (m === 'near' || m === 'under' || m === 'free') {
          for (const r of job.rels) {
            const subj = Array.isArray(r.a) ? r.a.includes(job.id) : r.a === job.id; if (!subj) continue;
            for (const p of REL.propose(r, job.id, { ...shape }, env)) if (passRegion(p)) poses.push({ ...p, mirror: false, dyn: true });
            if (m === 'free' && r.rel === 'facing') { /* ориентация добавляется ниже */ }
          }
        }
      }
      // притяжение к партнёрам отношений: у стены — напротив центра партнёра; на стене — над предметом у этой стены
      const partners = job.rels.flatMap(r => r.members).filter(id => id !== job.id).map(get).filter(Boolean);
      if (partners.length && (methods.includes('wall') || methods.includes('wallMount'))) {
        const attract = new Map();
        for (const w of room.walls) { const ts = []; for (const P of partners) { const t = (P.fr.x - w.a.x) * w.u.x + (P.fr.y - w.a.y) * w.u.y; if (t > 0 && t < w.len) ts.push(t); } if (ts.length) attract.set(w.id, ts); }
        if (methods.includes('wall')) for (const p of C.wallPoses(room, shape, { onlyAttract: true, attract, gap: KP.backGapOf(job.typeId)[0], radiators: prep.radiators, mirrors })) if ((!filt.walls || filt.walls.has(p.wallId)) && passRegion(p)) poses.push({ ...p, dyn: true });
        if (methods.includes('wallMount')) {
          const elevAt = (w, t) => { const base = C.elevationsOf(shape); for (const P of partners) { const bw = AR.backWall(P, room); if (bw && bw.wall.id === w.id && Math.abs(bw.t - t) < P.w / 2) return [...base, round1(P.hInt[1] + 150)]; } return base; };
          for (const p of C.mountPoses(room, shape, { onlyAttract: true, attract, elevAt })) if (!filt.walls || filt.walls.has(p.wallId)) poses.push({ ...p, dyn: true });
        }
      }
      // исходная поза предмета всегда среди кандидатов (ТЗ §19.4), если не противоречит обязательным отношениям места
      if (job.orig && !job.added && !job.outside) {
        const od = prep.origDesc.get(job.id);
        const obw = od && !od.invalid ? AR.backWall(od, room) : null;
        const fits = od && !od.invalid && (!filt.walls || (obw && filt.walls.has(obw.wall.id))) && (!regionPoly || G.pointInPoly({ x: od.fr.x, y: od.fr.y }, regionPoly));
        if (fits) {
          if (job.mount === 'wall') poses.push({ wallId: job.orig.wallId, offset: job.orig.offset, elev: job.orig.elev ?? job.orig.dims.E ?? 0, tag: 'orig', dyn: true });
          else if (job.mount === 'ontop') { const B = get(job.orig.baseId); if (B) poses.push({ x: job.orig.x, y: job.orig.y, rot: job.orig.rot, mirror: job.orig.mirror, baseId: B.id, tag: 'orig', dyn: true }); }
          else poses.push({ ...AR.poseFromAnchor(AR.anchorOf(od, room), job.typeId, shape.formId, shape.dims), tag: 'orig', dyn: true });
        }
      }
    }
    if (poses.length) out.push({ e, shape, poses });
  }
  return out;
}
function bump(reasons, code, extra) { const r = reasons.get(code) || { code, n: 0 }; r.n++; if (extra) Object.assign(r, extra); reasons.set(code, r); }
function poseKey(pose) { return pose.wallId != null && pose.offset != null ? `m${pose.wallId}:${round1(pose.offset)}:${round1(pose.elev)}` : `${round1(pose.x)}:${round1(pose.y)}:${Math.round(pose.rot * 10)}:${pose.mirror ? 1 : 0}:${pose.baseId || ''}`; }

/* Описание кандидата + статическая проверка (кеш по позе и товару; позы на основании зависят от состояния) */
/* Описание кандидата + статическая проверка (кеш по заданию, товару и позе; позы на основании зависят от состояния) */
function candDesc(prep, job, cand, S) {
  const make = () => {
    const item = materialize(job, cand.e, cand.pose);
    const D = withBBZ(describeItem(prep, item, (id) => S.placed.get(id) || prep.fixedById.get(id)));
    if (!D || D.invalid) return { D: null, bad: { code: 'OUTSIDE' } };
    return { D, bad: staticCheck(prep, D, job.moves || job.rides ? null : prep.origKeys) };
  };
  if (cand.pose.dyn && cand.pose.baseId) return make();
  if (!cand.pose.dyn) { const m = cand.pose._cd || (cand.pose._cd = new Map()); let r = m.get(job.id); if (!r) { r = make(); m.set(job.id, r); } return r; }
  return cached(prep, `d|${job.id}|${cand.e.p.id}|${poseKey(cand.pose)}`, make);
}

/* Динамическая проверка против уже поставленного; возвращает null или {code,id} и заполняет обновления зон */
const EMPTY = new Set();
/* Против уже поставленного. Помеха зоне недопустима, если задетая зона оказывается среди нарушенных
   (в том числе уже нарушенных раньше — не усугублять, §11.8). Обновления зон — в upd. */
function dynamicCheck(prep, S, D, upd) {
  let blockedD = D.blockedStatic || EMPTY, own = false;
  const addOwn = (k) => { if (blockedD.has(k)) return; if (!own) { blockedD = new Set(blockedD); own = true; } blockedD.add(k); };
  if (D.mount === 'ontop') {
    const B = S.placed.get(D.item.baseId) || prep.fixedById.get(D.item.baseId); const v = AR.baseCheck(D, B); if (v) return { code: 'BASE', id: B && B.id };
    for (const F of prep.fixedDescs) { if (!AR.bbOverlap(D.bb, F.bb)) continue; const pv = AR.pairChecks(D, F); if (pv.length) return { code: pv[0].code, id: F.id }; }
  }
  const hit = (A, cur, ks) => { const nb = new Set(cur); for (const k of ks) nb.add(k); const fz = AR.failingZones(A, nb); return { nb, bad: fz.some(i => ks.includes(i)) }; };
  for (const P of S.placed.values()) {
    if (!AR.bbOverlap(D.bbZ, P.bbZ)) continue;
    const pv = AR.pairChecks(D, P); if (pv.length) return { code: pv[0].code, id: P.id };
    for (const k of AR.blocksZones(D, P)) addOwn(k);
    const ks = AR.blocksZones(P, D);
    if (ks.length) { const h = hit(P, S.blocked.get(P.id) || EMPTY, ks); if (h.bad || P.zoneAllowFail) return { code: 'SERVICE_ZONE', id: P.id }; upd.push([P.id, h.nb]); }
  }
  for (const [fid, ks] of D.blocksFixed || []) {
    const F = prep.fixedById.get(fid); const h = hit(F, S.blocked.get(fid) || prep.fixedBlocked.get(fid), ks);
    if (h.bad && !(D.allowFixedFail && D.allowFixedFail.has(fid))) return { code: 'SERVICE_ZONE', id: fid };
    upd.push([fid, h.nb]);
  }
  if (D.zoneAllowFail) { if (own) return { code: 'SERVICE_ZONE' }; }
  else if (own && AR.failingZones(D, blockedD).length) return { code: 'SERVICE_ZONE' };
  upd.push([D.id, blockedD]);
  return null;
}

/* Локальная оценка кандидата (отношения + зоны + товар + подсказки + устойчивость) */
/* Общее для всех кандидатов задания в одном состоянии: соседи, окружение отношений, применимые отношения */
function localCtx(prep, job, S) {
  const env = { room: prep.room, cur: null, all: null, get(id) { return id === job.id ? this.cur : S.placed.get(id) || prep.fixedById.get(id); } };
  return { others: [...S.placed.values(), ...prep.fixedDescs], env, rels: job.rels.filter(r => r.members.every(id => id === job.id || S.placed.has(id) || prep.fixedById.has(id))) };
}
function localScore(prep, job, D, e, lc, concept, rnd) {
  const { others, env } = lc; env.cur = D;
  let s = 0;
  for (const r of lc.rels) { const v = REL.score(r, env); if (v != null) s += W.rel * (KP.PRIORITY_WEIGHT[r.prio] || 2) * v; }
  // рекомендуемые зоны свободны; не залезать в чужие рекомендуемые зоны
  let zn = 0, zc = 0;
  for (const z of D.zones) {
    if (z.ignored || !z.softPts) continue; zc++;
    if (z.softInside === undefined) z.softInside = G.insideRoom(z.softPts, prep.room.project, prep.room.d);
    let ok = z.softInside;
    if (ok) for (const B of others) { if (!B.solid || B.id === D.id || !AR.bbOverlap(z.softBB, B.bb) || D.softGuests.includes(B.typeId)) continue; if (G.polyIntersect(z.softPts, B.poly, z.softS, B.polyS)) { ok = false; break; } }
    if (ok) zn++;
  }
  if (zc) s += W.zone * zn / zc;
  if (D.solid) for (const B of others) {
    if (!B.zones.length || !AR.bbOverlap(D.bb, B.bbZ || B.bb) || B.softGuests.includes(D.typeId)) continue;
    for (const z of B.zones) if (!z.ignored && z.softPts && AR.bbOverlap(z.softBB, D.bb) && G.polyIntersect(z.softPts, D.poly, z.softS, D.polyS)) { s -= W.intrude; break; }
  }
  s += W.prod * e.s;
  if (D._bw === undefined) D._bw = D.mount === 'floor' ? AR.backWall(D, prep.room) : null;
  const bw = D._bw;
  // подсказки замысла: стена или область
  if (job.hintWalls) s += W.hint * ((D.mount === 'wall' ? job.hintWalls.has(D.item.wallId) : bw && job.hintWalls.has(bw.wall.id)) ? 1 : 0);
  if (job.hintRegion) s += W.hint * (G.pointInPoly({ x: D.fr.x, y: D.fr.y }, job.hintRegion) ? 1 : 0);
  // устойчивость: у перемещаемых — ближе к исходному месту (сильнее в замысле «близко к вашей расстановке»)
  if (job.moves && !job.added && (!job.placeholder || concept.basis === 'close_to_user')) { const od = prep.origDesc.get(job.id); if (od && od.fr && !od.outside) { const d = Math.hypot(D.fr.x - od.fr.x, D.fr.y - od.fr.y) + (AR.angDiff(D.fr.rot, od.fr.rot) > 1 ? 400 : 0); s += (concept.basis === 'close_to_user' ? W.stayUser : W.stay) * (1 - AR.lerp01(d, 0, 3000)); } }
  // аккуратность: у стены — к углу или по центру участка; свободно стоящий без отношений — ближе к центру области
  if (bw) { const w = bw.wall; const snug = Math.min(Math.abs(bw.t - D.w / 2), Math.abs(w.len - D.w / 2 - bw.t)); const seg = (w._free || (w._free = REL.freeSegments(w))).find(([a, b]) => bw.t >= a && bw.t <= b); const cen = seg ? Math.abs(bw.t - (seg[0] + seg[1]) / 2) : 1e9; s += W.neat * (1 - AR.lerp01(Math.min(snug, cen), 0, 300)); }
  else if (D.mount === 'floor' && !job.rels.length) { const g = prep.room.regions.find(r => G.pointInPoly({ x: D.fr.x, y: D.fr.y }, r.poly)) || prep.room.regions[0]; const d = Math.hypot(D.fr.x - g.center.x, D.fr.y - g.center.y); s += W.neat * (1 - AR.lerp01(d, 0, Math.sqrt(g.area))); }
  return s + 1e-4 * rnd.next();
}

/* ---------- Лучевой поиск (ТЗ §19.3) ---------- */
function solveConcept(prep, concept, opts = {}) {
  const L = prep.L; const t0 = Date.now();
  const seed = hashSeed(opts.seed ?? 'seed', concept.key || 'c'); const rnd = rng(seed);
  const diag = []; const jobs = conceptJobs(prep, concept, diag); const rels = conceptRelations(prep, concept, jobs, diag);
  for (const j of jobs) j.rels = localRels(rels, j.id);
  // члены групп, которых ставят от якоря: для заглядывания вперёд при выборе позы якоря
  const jobsById = new Map(jobs.map(j => [j.id, j]));
  for (const j of jobs) j.dependents = [];
  for (const r of rels) {
    if (!r.b || !['around', 'in_front_of', 'beside', 'under'].includes(r.rel)) continue; const anchor = jobsById.get(r.b); if (!anchor) continue;
    for (const id of Array.isArray(r.a) ? r.a : [r.a]) { const m = jobsById.get(id); if (m && m.moves && m !== anchor) anchor.dependents.push({ m, r: r.rel === 'around' ? { ...r, a: [id] } : r }); }
  }
  // подсказки замысла по месту — один раз на задание
  for (const j of jobs) {
    const h = (concept.hints || []).find(x => x.itemId === j.id) || (j.zone ? { zone: j.zone } : null); if (!h) continue;
    const z = h.zone ? (concept.zones || []).find(x => x.id === h.zone) : null; const wall = h.wall || (z && z.wall), region = h.region || (z && z.region);
    if (wall) { const ws = R.resolveWall(prep.room, wall, {}); if (ws.length) j.hintWalls = new Set(ws.map(w => w.id)); }
    if (region) { const g = prep.room.regions.find(r => r.id === region); if (g) j.hintRegion = g.poly; }
  }
  const order = orderJobs(jobs, rels);
  const stats = { expansions: 0, candidates: 0, nondeterministic: false, truncated: false, seed };
  let beam = [{ placed: new Map(), blocked: new Map(), score: 0, spent: 0, first: null, picks: new Map() }];
  const dropped = []; const failed = [];
  const reserveAfter = new Map(); { let acc = 0; for (let i = order.length - 1; i >= 0; i--) { reserveAfter.set(i, acc); const j = order[i]; if (j.picks && j.required) acc += minPrice(j); } }
  for (let oi = 0; oi < order.length; oi++) {
    const job = order[oi]; const reasons = new Map(); let next = [];
    for (let stage = 0; stage <= L.maxStage; stage++) {
      if (stage === 5) { if (!job.required) break; continue; }
      job.stage = stage;
      const greedy = stats.expansions >= L.maxExpansions || Date.now() - t0 > L.timeMs;
      if (greedy) { stats.truncated = true; if (Date.now() - t0 > L.timeMs) stats.nondeterministic = true; beam = beam.slice(0, 1); }
      next = []; const expanded = [];
      for (const S of beam) {
        stats.expansions++;
        const env = { room: prep.room, get: (id) => S.placed.get(id) || prep.fixedById.get(id), all: null };
        const groups = gather(prep, job, S, stage, env, concept, reasons);
        const scored = []; const seen = new Set(); const lc = localCtx(prep, job, S);
        const quick = (job.mount === 'floor' || job.mount === 'wall') ? quickReach(prep, S) : null;
        const cand = { e: null, pose: null };
        for (const g of groups) for (const pose of g.poses) {
          cand.e = g.e; cand.pose = pose;
          stats.candidates++;
          const { D, bad } = candDesc(prep, job, cand, S);
          if (bad) { bump(reasons, bad.code, bad.id ? { id: bad.id } : null); continue; }
          if (seen.has(D)) continue; seen.add(D);
          if (cand.pose.dyn && cand.pose.baseId && D.blockedStatic === undefined) { D.blockedStatic = new Set(); D.blocksFixed = new Map(); }
          const upd = []; const dv = dynamicCheck(prep, S, D, upd);
          if (dv) { bump(reasons, dv.code, dv.id ? { id: dv.id } : null); continue; }
          if (quick && !quick(D)) { bump(reasons, 'ACCESS'); continue; }
          const price = job.picks && !cand.e.p.missing ? (cand.e.p.price || 0) : 0;
          if (prep.budget.limit !== Infinity && prep.budget.limit != null && prep.budget.F + S.spent + price + reserveAfter.get(oi) > prep.budget.limit + 0.005) { bump(reasons, 'BUDGET', { need: Math.round(prep.budget.F + S.spent + price + reserveAfter.get(oi) - prep.budget.limit) }); continue; }
          scored.push({ D, e: cand.e, upd, price, ls: localScore(prep, job, D, cand.e, lc, concept, rnd), tag: cand.pose.tag });
        }
        scored.sort((a, b) => b.ls - a.ls);
        if (job.dependents.length) { const top = scored.slice(0, L.branch * 3); for (const c of top) c.ls += W.look * lookahead(prep, S, job, c); top.sort((a, b) => b.ls - a.ls); scored.splice(0, top.length, ...top); }
        expanded.push({ S, scored });
      }
      // дети по страницам: сначала 12 лучших поз каждого состояния; если все отсечены по доступности — следующие
      const B = greedy ? 1 : L.branch; const checkAccess = job.mount === 'floor' || job.mount === 'wall';
      // страницы растут: 12, 24, 48, …; последняя — всё оставшееся
      const pageAt = (k) => B * ((1 << k) - 1);
      for (let page = 0; page < (checkAccess ? L.accessPages : 1) && !next.length; page++) {
        const children = [];
        const last = page === L.accessPages - 1;
        for (const { S, scored } of expanded) for (const c of scored.slice(checkAccess ? pageAt(page) : 0, checkAccess && !last ? pageAt(page + 1) : B)) {
          const placed = new Map(S.placed); placed.set(job.id, c.D);
          const blocked = new Map(S.blocked); for (const [k, v] of c.upd) blocked.set(k, v);
          const picks = job.picks ? new Map(S.picks).set(job.id, c.e) : S.picks;
          const first = S.first || (Math.floor(job.rank) <= 1 && job.moves ? poseKey({ x: c.D.fr.x, y: c.D.fr.y, rot: c.D.fr.rot, mirror: c.D.fr.mirror }) : null);
          children.push({ placed, blocked, score: S.score + c.ls, spent: S.spent + c.price, first, picks, newD: c.D, par: S });
        }
        if (!children.length) break;
        if (!checkAccess) { next = children; break; }
        // отсечение по доступности (ТЗ §19.3 п. 4): лениво, только для состояний, попадающих в луч
        children.sort((a, b) => b.score - a.score);
        for (const S of children) { if (next.length >= L.beam) break; if (S.newD && cannotBlock(prep, S) || accessOk(prep, S)) next.push(S); else bump(reasons, 'ACCESS'); }
      }
      for (const { S } of expanded) releaseDist(prep, S);
      for (const S of next) { delete S.par; delete S.newD; }
      if (next.length) break;
    }
    if (!next.length) {
      if (!job.required) { dropped.push({ itemId: job.id, typeId: job.typeId, text: `Хотел добавить «${job.name}» — не поместилось`, reasons: topReasons(reasons) }); continue; }
      failed.push({ itemId: job.id, typeId: job.typeId, name: job.name, reasons: topReasons(reasons) });
      return finish(prep, concept, [], rels, { diag, dropped, failed, stats, t0, jobs, opts, partial: beam[0] });
    }
    // лучшие состояния; не больше sameFirst с одинаковой позой первого якоря (разнообразие)
    next.sort((a, b) => b.score - a.score);
    const perFirst = new Map(); beam = [];
    for (const S of next) { const k = S.first || '-'; const n = perFirst.get(k) || 0; if (n >= L.sameFirst && S.first) continue; perFirst.set(k, n + 1); beam.push(S); if (beam.length >= L.beam) break; }
  }
  return finish(prep, concept, beam, rels, { diag, dropped, failed, stats, t0, jobs, opts });
}
/* Заглядывание вперёд: поместятся ли члены группы (стулья вокруг стола, тумбы у кровати) при этой позе якоря. 0–1 */
function lookahead(prep, S, job, c) {
  const S2 = { placed: new Map(S.placed).set(job.id, c.D), blocked: new Map(S.blocked) }; for (const [k, v] of c.upd) S2.blocked.set(k, v);
  const env = { room: prep.room, get: (id) => S2.placed.get(id) || prep.fixedById.get(id), all: null };
  let need = 0, have = 0, aroundNeed = 0, aroundSlots = -1;
  const fits = (m, r, all) => {
    const e = m.products.cand[0]; if (!e) return 0; const shape = C.shapeOf(m.typeId, e.p.formId || m.formId, e.p.dims); const keys = new Set();
    for (const pose of REL.propose(r, m.id, shape, env)) {
      const { D, bad } = candDesc(prep, m, { e, pose: { ...pose, mirror: false, dyn: true } }, S2); if (bad) continue;
      if (dynamicCheck(prep, S2, D, [])) continue; keys.add(pose.tag); if (!all) break;
    }
    return keys.size;
  };
  for (const { m, r } of job.dependents) {
    if (S.placed.has(m.id)) continue;
    if (r.rel === 'around') { aroundNeed++; if (aroundSlots < 0) aroundSlots = fits(m, r, true); }
    else { need++; if (fits(m, r, false)) have++; }
  }
  if (aroundNeed) { need += aroundNeed; have += Math.min(aroundNeed, aroundSlots); }
  return need ? have / need : 1;
}
function topReasons(reasons) { const all = [...reasons.values()].sort((a, b) => b.n - a.n); const top = all.slice(0, 3); for (const c of ['ACCESS', 'BUDGET']) { const r = reasons.get(c); if (r && !top.includes(r)) top.push(r); } return top; }
/* Новый предмет не может испортить проходы, если рядом с ним (ближе ширины прохода) нет других препятствий,
   кроме стены за спиной, соседних стен вплотную и соседей вплотную у той же стены. Тогда полная проверка не нужна. */
function cannotBlock(prep, S) {
  const D = S.newD; if (!D.solid || D.mount === 'ontop') return true;
  const room = prep.room; const c = prep.accessGrid.c; const need = 2 * AR.PASS.inflate + 2 * c;
  if (D._bw === undefined) D._bw = D.mount === 'floor' ? AR.backWall(D, room) : null;
  const back = D.mount === 'wall' ? room.W.get(D.item.wallId) : D._bw && D._bw.wall;
  if (!back) return false;
  for (const w of room.walls) {
    if (w === back) continue;
    let d = Infinity; for (const p of D.poly) d = Math.min(d, G.distPtSeg(p, w.a, w.b)); if (d >= need) continue;
    if (d <= c && (w.id === back.prev || w.id === back.next)) continue;
    return false;
  }
  for (const z of room.zones.entry) if (AR.polyDist(D.poly, z.pts) < need) return false;
  for (const P of S.placed.values()) if (P !== D && !check(P)) return false;
  for (const P of prep.fixedDescs) if (!check(P)) return false;
  return ownReachable(prep, S);
  function check(P) {
    if (!P.solid || P.mount === 'ontop' || P.outside || P.invalid) return true;
    const dx = Math.max(0, D.bb.x0 - P.bb.x1, P.bb.x0 - D.bb.x1), dy = Math.max(0, D.bb.y0 - P.bb.y1, P.bb.y0 - D.bb.y1);
    if (dx * dx + dy * dy >= need * need) return true;
    const d = AR.polyDist(D.poly, P.poly); if (d >= need) return true;
    if (P._bw === undefined) P._bw = P.mount === 'floor' ? AR.backWall(P, room) : null;
    const pb = P.mount === 'wall' ? room.W.get(P.item.wallId) : P._bw && P._bw.wall;
    return d <= c && pb === back;
  }
}
/* Поле расстояний родителя считается один раз на состояние; ребёнок = родитель + один предмет, поле обновляется локально */
function parentDist(prep, S) {
  if (S._dist) return S._dist;
  const grid = prep.accessGrid; const descs = [...prep.fixedDescs, ...S.placed.values()];
  const pi = AR.passInfo(prep.room, descs, { base: prep.passBase, scratch: true, grid });
  const buf = (prep.distPool && prep.distPool.pop()) || new Float32Array(grid.nx * grid.ny); buf.set(pi.dist); S._dist = buf; return buf;
}
function releaseDist(prep, S) { S._pi = null; if (S._dist) { (prep.distPool || (prep.distPool = [])).push(S._dist); S._dist = null; } }
/* Быстрый отсев поз в недоступной части комнаты: точки по периметру цели доступа должны быть достижимы
   по полю родителя (без самого предмета). Точная проверка — дальше, для состояний луча. */
function quickReach(prep, S) {
  if (!S.placed.size && !prep.fixedDescs.length) return null;
  const grid = prep.accessGrid;
  if (!S._pi) S._pi = AR.passInfo(prep.room, [], { grid, dist: parentDist(prep, S) });
  const pi = S._pi; if (!pi.entranceOk && !pi.starts.length) return null;
  const e = pi.r + grid.c;
  return (D) => {
    if (!AR.needsAccess(D)) return true;
    for (const t of AR.accessTargets(D, e)) {
      const cells = [];
      for (let i = 0; i < t.length; i++) { const a = t[i], b = t[(i + 1) % t.length]; const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 150)); for (let q = 0; q < n; q++) { const k = R.cellOf(grid, { x: a.x + (b.x - a.x) * q / n, y: a.y + (b.y - a.y) * q / n }); if (k >= 0) cells.push(k); } }
      if (pi.reachesCells(cells)) return true;
    }
    return false;
  };
}
/* До самого нового предмета можно дойти (по полю родителя; клетки у самого предмета станут непроходимыми — их не считаем) */
function ownReachable(prep, S) {
  const D = S.newD; if (!AR.needsAccess(D)) return true;
  const P = S.par; const grid = prep.accessGrid;
  if (!P._pi) P._pi = AR.passInfo(prep.room, [], { grid, dist: parentDist(prep, P) });
  const pi = P._pi; const e = pi.r + grid.c;
  for (const t of AR.accessTargets(D, e)) {
    const cells = R.cellsOf(grid, t).filter(k => { const p = R.cellCenter(grid, k); if (G.pointInPoly(p, D.poly)) return false; let d = Infinity; for (let q = 0; q < D.poly.length; q++) d = Math.min(d, G.distPtSeg(p, D.poly[q], D.poly[(q + 1) % D.poly.length])); return d - grid.c / 2 >= pi.thr; });
    if (pi.reachesCells(cells)) return true;
  }
  return false;
}
function childDist(prep, S) {
  const grid = prep.accessGrid; const D = S.newD; const base = parentDist(prep, S.par);
  const out = prep._childDist && prep._childDist.length === base.length ? prep._childDist : (prep._childDist = new Float32Array(base.length)); out.set(base);
  if (!(D.solid && D.mount !== 'ontop' && !D.invalid && !D.outside)) return out;
  const reach = AR.PASS.inflate + grid.c; const bb = D.bb; const P = D.poly;
  const i0 = Math.max(0, Math.floor((bb.x0 - reach - grid.x0) / grid.c)), i1 = Math.min(grid.nx - 1, Math.floor((bb.x1 + reach - grid.x0) / grid.c));
  const j0 = Math.max(0, Math.floor((bb.y0 - reach - grid.y0) / grid.c)), j1 = Math.min(grid.ny - 1, Math.floor((bb.y1 + reach - grid.y0) / grid.c));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * grid.nx + i; if (!out[k]) continue;
    const p = { x: grid.x0 + (i + 0.5) * grid.c, y: grid.y0 + (j + 0.5) * grid.c };
    let d; if (G.pointInPoly(p, P)) d = 0; else { d = Infinity; for (let q = 0; q < P.length; q++) d = Math.min(d, G.distPtSeg(p, P[q], P[(q + 1) % P.length])); d -= grid.c / 2; if (d < 0) d = 0; }
    if (d < out[k]) out[k] = d;
  }
  return out;
}
function accessOk(prep, S) {
  const descs = [...prep.fixedDescs, ...S.placed.values()];
  const dist = S.par && S.newD ? childDist(prep, S) : null;
  const v = AR.accessCheck(prep.room, descs, AR.passInfo(prep.room, descs, { base: prep.passBase, scratch: true, grid: prep.accessGrid, dist }));
  return v.every(x => prep.baseAccess.has(x.rule + '|' + x.ids.join(',')));
}

/* ---------- Завершение: сборка, полная проверка, оценка, улучшение ---------- */
function buildFurniture(prep, S, jobsById) {
  const out = [];
  for (const f of prep.orig) { const D = S.placed.get(f.id); out.push(D ? outItem(prep, D.item, f) : clone(f)); }
  for (const [id, D] of S.placed) if (!prep.origById.has(id)) { const j = jobsById.get(id); out.push({ ...outItem(prep, D.item, null), aiAdded: true, ...(j && j.reason ? { aiReason: j.reason } : {}) }); }
  return out;
}
function outItem(prep, f, orig) {
  const o = clone(f);
  // на основании координаты не округляются: иначе относительная поза на тумбе «плывёт» больше допуска 1 мм
  for (const k of o.baseId ? ['offset', 'elev'] : ['x', 'y', 'offset', 'elev']) if (typeof o[k] === 'number') o[k] = Math.round(o[k]);
  // неизменённые координаты — как в снимке (ТЗ Б.1: округляются только изменённые)
  if (orig) { const same = ['x', 'y', 'rot', 'offset', 'elev'].every(k => o[k] === undefined || orig[k] === undefined || Math.abs(o[k] - orig[k]) < 1); if (same && o.wallId === orig.wallId && o.baseId === orig.baseId && !!o.mirror === !!orig.mirror) for (const k of ['x', 'y', 'rot', 'offset', 'elev']) if (orig[k] !== undefined) o[k] = orig[k]; }
  o.warnings = []; return o;
}
function changesOf(prep, furniture) {
  let moved = 0, products = 0, added = 0;
  for (const f of furniture) {
    const o = prep.origById.get(f.id); if (!o) { added++; continue; }
    if (o.productId !== f.productId) products++;
    const d = o.wallId ? Math.abs((o.offset || 0) - (f.offset || 0)) + Math.abs((o.elev || 0) - (f.elev || 0)) + (o.wallId !== f.wallId ? 1e4 : 0) : Math.hypot(o.x - f.x, o.y - f.y) + (AR.angDiff(o.rot, f.rot) > 0.1 ? 1e3 : 0);
    if (d > 1) moved++;
  }
  return { moved, products, added, total: moved + products + added };
}
function scoreFurniture(prep, concept, rels, furniture, picks, opts = {}) {
  const p = { ...prep.project, furniture };
  const ctx = AR.mkCtx(prep.room, furniture, { productById: prep.productById });
  const descs = AR.describeAll(prep.room, furniture, ctx).filter(D => !D.outside || AR.policyOf(prep.origById.get(D.id) || D.item) !== 'keep');
  const env = REL.mkEnv(prep.room, descs);
  const extra = {};
  const conceptRels = rels.filter(r => !r.template);
  const m11 = REL.scoreAll(conceptRels, env); if (m11) extra.M11 = { s: m11.s, text: `Выполнено ${m11.done} из ${m11.n} связей замысла`, data: m11 };
  if (opts.photoRelations && opts.photoRelations.length) { const m12 = REL.scoreAll(opts.photoRelations, env); extra.M12 = { s: m12.done / m12.n, text: `Повторили ${m12.done} из ${m12.n} связей с фото`, data: m12 }; }
  const ps = [...picks.values()].filter(e => !e.p.missing); if (ps.length) extra.M13 = { s: ps.reduce((a, e) => a + e.s, 0) / ps.length, text: 'Оценка товаров' };
  const total = prep.budget.F + [...picks.values()].reduce((s, e) => s + (e.p.missing ? 0 : e.p.price || 0), 0);
  const b = prep.budget;
  if (b.mode === 'over') extra.M14 = { s: total <= b.amount ? 1 : Math.max(0, 1 - (total - b.amount) / (b.amount * (b.overPct || 1) / 100)), text: `Итог ${Math.round(total)}` };
  if (b.mode === 'target') extra.M14 = { s: Math.max(0, Math.min(1, 1 - 2 * Math.max(0, (total - b.amount) / b.amount) - Math.max(0, (0.75 * b.amount - total) / b.amount))), text: `Итог ${Math.round(total)}` };
  if (opts.baseVariant) { const base = new Map(opts.baseVariant.map(f => [f.id, f])); const keep = furniture.filter(f => base.has(f.id) && !(opts.touched || []).includes(f.id)); const same = keep.filter(f => { const o = base.get(f.id); return o.productId === f.productId && Math.hypot((o.x || 0) - (f.x || 0), (o.y || 0) - (f.y || 0)) < 1 && (o.offset || 0) === (f.offset || 0); }).length; extra.M15 = { s: keep.length ? same / keep.length : 1, text: 'Остальное на месте' }; }
  const soft = AR.soft(prep.room, descs, { people: prep.task.people, purpose: prep.task.purpose, productById: prep.productById, extra });
  return { score: AR.combine(soft), soft, total, project: p };
}
function checkFurniture(prep, furniture, picks) {
  const b = prep.budget; const limit = b.limit != null && isFinite(b.limit) ? b.limit : null;
  const total = picks ? b.F + [...picks.values()].reduce((s, e) => s + (e.p.missing ? 0 : Math.max(0, e.p.price || 0)), 0) : null;
  return AR.validate({ ...prep.project, furniture }, { original: prep.project, productById: prep.productById, allowAdd: !!prep.task.allowAdd, room: prep.room, originalViolations: prep.origViolations, budget: limit != null && total != null ? { limit, total } : null });
}
function finish(prep, concept, beam, rels, ctx) {
  const L = prep.L; const jobsById = new Map(ctx.jobs.map(j => [j.id, j]));
  const sols = []; const invalid = [];
  for (const S of beam) {
    const furniture = buildFurniture(prep, S, jobsById);
    const val = checkFurniture(prep, furniture, S.picks);
    if (!val.ok) { invalid.push(val.violations.filter(v => !v.inherited)); continue; }
    const ev = scoreFurniture(prep, concept, rels, furniture, S.picks, ctx.opts || {});
    sols.push({ furniture, picks: S.picks, score: ev.score, soft: ev.soft, total: ev.total, violations: val.violations, S });
  }
  sols.sort((a, b) => b.score - a.score);
  // локальное улучшение лучших (ТЗ §19.3 п. 5): сдвиги вдоль стены, поворот свободных; число попыток ограничено
  for (const s of sols.slice(0, 1)) improve(prep, concept, rels, s, ctx.jobs);
  // уникальные, по убыванию оценки; при равенстве (< 1) — меньше изменений, затем дешевле (§20.3)
  const seen = new Set(); const uniq = [];
  for (const s of sols) { s.changes = changesOf(prep, s.furniture); const sig = signature(s.furniture); if (seen.has(sig)) continue; seen.add(sig); uniq.push(s); }
  uniq.sort((a, b) => (Math.abs(a.score - b.score) >= 1 ? b.score - a.score : a.changes.total - b.changes.total || a.total - b.total || b.score - a.score));
  // для отладки: лучшая отвергнутая полная расстановка и её нарушения
  const worst = beam.length ? beam[0] : ctx.partial;
  const rejected = !uniq.length && worst ? { furniture: buildFurniture(prep, worst, jobsById), violations: invalid[0] || [], partial: !beam.length } : null;
  if (rejected) Object.defineProperty(rejected, 'state', { value: worst, enumerable: false });
  const solutions = uniq.slice(0, L.solutions).map(s => ({
    conceptKey: concept.key, score: +s.score.toFixed(2), soft: s.soft, furniture: s.furniture, total: s.total, changes: s.changes,
    products: Object.fromEntries([...s.picks].map(([id, e]) => [id, e.p.missing ? null : e.p.id])),
    inherited: s.violations.filter(v => v.inherited), dropped: ctx.dropped,
  }));
  const diagnostics = [...ctx.diag];
  for (const f of ctx.failed) for (const r of f.reasons) diagnostics.push({ code: r.code, itemId: f.itemId, blockedBy: r.id || null, numbers: numbersOf(prep, f, r), count: r.n });
  if (ctx.failed.length && !ctx.failed[0].reasons.length) diagnostics.push({ code: 'NO_WALL_SPACE', itemId: ctx.failed[0].itemId, numbers: numbersOf(prep, ctx.failed[0], { code: 'NO_WALL_SPACE' }) });
  if (!ctx.failed.length && !solutions.length && invalid.length) { const v = invalid[0][0]; if (v) diagnostics.push({ code: v.code, itemId: v.ids[0] || null, text: v.text, numbers: v.numbers }); }
  for (const d of ctx.dropped) diagnostics.push({ code: 'DROPPED', itemId: d.itemId, text: d.text });
  ctx.stats.ms = Date.now() - ctx.t0;
  return { conceptKey: concept.key, solutions, diagnostics, stats: ctx.stats, rejected };
}
function numbersOf(prep, f, r) {
  const job = prep.jobs.find(j => j.id === f.itemId); if (!job) return {};
  const e = job.products.cand[0]; if (!e) return {};
  const shape = C.shapeOf(job.typeId, e.p.formId || job.formId, e.p.dims);
  if (r.code === 'NO_WALL_SPACE' || r.code === 'OUTSIDE') return { need: Math.round(shape.w), max: Math.round(Math.max(...prep.room.walls.map(w => Math.max(0, ...REL.freeSegments(w).map(([a, b]) => b - a))))) };
  return r.need ? { need: r.need } : {};
}
function signature(furniture) { return furniture.map(f => `${f.id}:${f.productId}:${Math.round((f.x || 0) / 50)}:${Math.round((f.y || 0) / 50)}:${Math.round((f.rot || 0) / 5)}:${f.wallId || ''}:${Math.round((f.offset || 0) / 50)}:${f.baseId || ''}`).join('|'); }

function improve(prep, concept, rels, sol, jobs) {
  const L = prep.L; let trials = 0;
  const movers = jobs.filter(j => j.moves && !j.rides && (j.mount === 'floor' || j.mount === 'wall')).sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : 1));
  for (const j of movers) {
    const idx = sol.furniture.findIndex(f => f.id === j.id); if (idx < 0) continue;
    const f0 = sol.furniture[idx]; const tries = [];
    if (j.mount === 'wall') for (const d of [-100, 100, -200, 200]) tries.push({ ...f0, offset: f0.offset + d });
    else {
      const D = AR.describe(f0, prep.room, AR.mkCtx(prep.room, sol.furniture, { productById: prep.productById }));
      const bw = D && AR.backWall(D, prep.room);
      if (bw) for (const d of [-50, 50, -100, 100, -200, 200]) tries.push({ ...f0, x: Math.round(f0.x + bw.wall.u.x * d), y: Math.round(f0.y + bw.wall.u.y * d) });
      else if (D) { for (const [dx, dy] of [[100, 0], [-100, 0], [0, 100], [0, -100]]) tries.push({ ...f0, x: f0.x + dx, y: f0.y + dy }); tries.push({ ...f0, rot: C.norm360(f0.rot + 90) }); }
    }
    for (const t of tries) {
      if (trials++ >= L.improveTrials) return;
      const furniture = sol.furniture.slice(); furniture[idx] = t;
      // едущие на основании — вместе с ним
      for (let k = 0; k < furniture.length; k++) if (furniture[k].baseId === j.id) { const rp = relPose(sol.furniture[k], f0); const fb = AR.mkFrame(t); const p = fb.w(rp.x, rp.y); furniture[k] = { ...furniture[k], x: Math.round(p.x), y: Math.round(p.y), rot: C.norm360(t.rot + rp.rot) }; }
      const val = checkFurniture(prep, furniture, sol.picks); if (!val.ok) continue;
      const ev = scoreFurniture(prep, concept, rels, furniture, sol.picks);
      if (ev.score > sol.score + 0.05) { Object.assign(sol, { furniture, score: ev.score, soft: ev.soft, total: ev.total, violations: val.violations }); break; }
    }
  }
}

/* Один вызов на весь запуск: все замыслы + выбор пары (ТЗ §20.4) */
function solve(input) {
  const prep = prepare(input.project, input.catalog, input.task || {}, input.limits || {});
  const results = (input.concepts || []).map((c, i) => solveConcept(prep, c, { seed: hashSeed(input.seed ?? 'run', i) }));
  return { results, prep };
}

module.exports = { VERSION, DEFAULTS, WALL_MOVABLE, prepare, solveConcept, solve, scoreFurniture, checkFurniture, changesOf };
module.exports._internal = { gather, candDesc, dynamicCheck, staticCheck, conceptJobs, conceptRelations, orderJobs, localRels, lookahead, accessOk };
