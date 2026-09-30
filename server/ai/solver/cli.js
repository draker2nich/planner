#!/usr/bin/env node
/* Офлайн-запуск солвера (ТЗ §19.6, И1): решения и SVG для фикстуры без языковой модели.
     node server/ai/solver/cli.js <fixture.json | id фикстуры | all> [--out dir] [--seed s] [--concept c1] [--json]
   Фикстура: { id, project, task, concepts, catalog? }. Без catalog берётся test/ai/fixtures/catalog.json. */
'use strict';
const fs = require('fs');
const path = require('path');
const { prepare, solveConcept } = require('./index.js');
const { renderSVG } = require('./svg.js');
const { hashSeed } = require('./rng.js');

function args(argv) { const a = { _: [] }; for (let i = 0; i < argv.length; i++) { const x = argv[i]; if (x.startsWith('--')) { const k = x.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; a[k] = v; } else a._.push(x); } return a; }
function loadFixtures(ref) {
  const root = path.join(__dirname, '../../../test/ai/fixtures');
  if (ref && fs.existsSync(ref) && ref.endsWith('.json')) return [JSON.parse(fs.readFileSync(ref, 'utf8'))];
  const all = require(path.join(root, 'index.js'));
  if (!ref || ref === 'all') return all;
  const f = all.byId(ref); if (!f) throw new Error(`Нет фикстуры ${ref}. Есть: ${all.map(x => x.id).join(', ')}`); return [f];
}
function catalogFor(fx) { if (fx.catalog) return fx.catalog; return require(path.join(__dirname, '../../../test/ai/fixtures/catalog.json')).products; }

function runFixture(fx, opts = {}) {
  const catalog = catalogFor(fx);
  const prep = prepare(fx.project, catalog, fx.task || {}, opts.limits || {});
  const concepts = (fx.concepts || []).filter(c => !opts.concept || c.key === opts.concept);
  const results = concepts.map((c, i) => solveConcept(prep, c, { seed: hashSeed(opts.seed ?? fx.id, i) }));
  return { prep, results };
}

if (require.main === module) {
  const a = args(process.argv.slice(2));
  const list = loadFixtures(a._[0]);
  const out = a.out || null; if (out) fs.mkdirSync(out, { recursive: true });
  let failed = 0;
  for (const fx of list) {
    const t = Date.now(); let run;
    try { run = runFixture(fx, { seed: a.seed, concept: a.concept }); }
    catch (e) { console.log(`✗ ${fx.id}: ${e.code || ''} ${e.message}`); failed++; continue; }
    const { prep, results } = run; const n = results.reduce((s, r) => s + r.solutions.length, 0);
    const ok = (fx.expect && fx.expect.feasible === false) ? n === 0 : n > 0; if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${fx.id} — ${fx.title || ''} (${Date.now() - t} мс)`);
    for (const r of results) {
      const best = r.solutions[0];
      console.log(`   ${r.conceptKey}: решений ${r.solutions.length}${best ? `, оценка ${best.solutions ? '' : best.score.toFixed(1)}, изменений ${best.changes.total}` : ''}; раскрытий ${r.stats.expansions}, кандидатов ${r.stats.candidates}, ${r.stats.ms} мс${r.stats.truncated ? ', обрезано' : ''}`);
      for (const d of r.diagnostics.slice(0, 4)) console.log(`      · ${d.code}${d.itemId ? ' ' + d.itemId : ''}${d.blockedBy ? ' ← ' + d.blockedBy : ''}${d.numbers && Object.keys(d.numbers).length ? ' ' + JSON.stringify(d.numbers) : ''}${d.text ? ' — ' + d.text : ''}`);
      if (best && a.soft) for (const [k, v] of Object.entries(best.soft)) if (v) console.log(`      ${k} ${v.s.toFixed(2)} ${v.text || ''}`);
      if (out) r.solutions.forEach((s, i) => fs.writeFileSync(path.join(out, `${fx.id}-${r.conceptKey}-${i + 1}.svg`), renderSVG(prep.room, s.furniture, { original: fx.project.furniture, productById: prep.productById, title: `${fx.id} · ${r.conceptKey} · вариант ${i + 1}`, subtitle: `оценка ${s.score.toFixed(1)} · изменений ${s.changes.total} · итог ${Math.round(s.total)}` })));
      if (out && !r.solutions.length) fs.writeFileSync(path.join(out, `${fx.id}-${r.conceptKey}-0.svg`), renderSVG(prep.room, r.rejected ? r.rejected.furniture : fx.project.furniture, { original: fx.project.furniture, productById: prep.productById, title: `${fx.id} · ${r.conceptKey} · решений нет`, subtitle: r.diagnostics.slice(0, 2).map(d => d.code + (d.itemId ? ' ' + d.itemId : '')).join(', ') }));
    }
    if (a.json && out) fs.writeFileSync(path.join(out, `${fx.id}.json`), JSON.stringify(results.map(r => ({ conceptKey: r.conceptKey, diagnostics: r.diagnostics, stats: r.stats, solutions: r.solutions.map(s => ({ score: s.score, changes: s.changes, total: s.total, furniture: s.furniture })) })), null, 1));
  }
  process.exitCode = failed ? 1 : 0;
}
module.exports = { runFixture, loadFixtures };
