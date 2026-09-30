/* Солвер на эталонном наборе (ТЗ §28.1–28.2): А1 инварианты, А2 жёсткие правила, А3 приём редактором,
   А4 детерминизм, А5 производительность, А10 угловые формы только в углах 88–92°. Без сети и без модели. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers.js');
const FIX = require('./fixtures/index.js');
const G = require('../../public/shared/geometry.js');
const AR = require('../../public/shared/ai-rules.js');
const { prepare, solveConcept } = require('../../server/ai/solver/index.js');
const { hashSeed } = require('../../server/ai/solver/rng.js');

const catalog = H.PRODUCTS;
const LIMIT_MS = 30000;   // предел ТЗ §27.1 для 40 предметов и 4 замыслов (цель — 10 с)
function run(fx) {
  const t = Date.now(); const prep = prepare(fx.project, catalog, fx.task);
  const results = fx.concepts.map((c, i) => solveConcept(prep, c, { seed: hashSeed(fx.id, i) }));
  return { prep, results, ms: Date.now() - t };
}
const strip = (r) => JSON.stringify(r.solutions.map(s => ({ score: s.score, furniture: s.furniture, products: s.products })));

for (const fx of FIX) {
  test(`фикстура ${fx.id}: ${fx.title}`, () => {
    const { prep, results, ms } = run(fx);
    const n = results.reduce((s, r) => s + r.solutions.length, 0);
    if (fx.expect.feasible === false) {
      assert.strictEqual(n, 0, 'невыполнимая комната не даёт вариантов');
      const codes = new Set(results.flatMap(r => r.diagnostics.map(d => d.code)));
      for (const c of fx.expect.codes || []) assert.ok(codes.has(c), `в диагностике есть ${c}: ${[...codes].join(', ')}`);
      return;
    }
    assert.ok(n >= fx.expect.minSolutions, `есть решения (${results.map(r => r.diagnostics.map(d => d.code).join('/')).join('; ')})`);
    for (const r of results) for (const s of r.solutions) {
      const p = { ...fx.project, furniture: s.furniture };
      // А1: инварианты прав (§11.7)
      assert.deepStrictEqual(AR.invariants(p, fx.project, { room: prep.room, allowAdd: fx.task.allowAdd }).map(v => v.text), [], 'А1');
      // А2: жёсткие правила — только унаследованные нарушения
      const v = AR.validate(p, { original: fx.project, productById: H.productById, allowAdd: fx.task.allowAdd });
      assert.deepStrictEqual(v.violations.filter(x => !x.inherited).map(x => x.text), [], 'А2');
      // А3: вариант принимает общая проверка редактора
      const d = G.derive(JSON.parse(JSON.stringify(p))); const pe = { ...p, furniture: p.furniture.map(f => ({ ...f, warnings: G.furnitureWarnings(f, p, d) })) };
      assert.strictEqual(G.validateFurniture(pe, d, { productById: H.productById }), null, 'А3');
      // А10: угловые формы — только во внутренних углах 88–92°
      const ctx = AR.mkCtx(prep.room, s.furniture, { productById: H.productById });
      for (const f of s.furniture) {
        const D = AR.describe(f, prep.room, ctx); if (!D || !['L', 'quarter'].includes(D.fp) || D.mount !== 'floor') continue;
        const a = AR.anchorOf(D, prep.room); if (a.kind !== 'corner') continue;
        const c = prep.room.corners.find(k => k.vertexId === a.vertexId); assert.ok(Math.abs(c.angle - 90) <= 2, `А10: ${f.id} в углу ${c.angle}°`);
      }
      // все пустышки получили товар, кроме инженерного оборудования
      for (const f of s.furniture) if (!f.productId) assert.strictEqual(require('../../public/shared/ai-knowledge/furniture.js').categoryOf(f.typeId), 'infra', `${f.id} без товара`);
    }
    if (fx.id === 'forty-items') { console.log(`А5: 40 предметов, ${fx.concepts.length} замысла — ${ms} мс`); assert.ok(ms < LIMIT_MS, `А5: ${ms} мс`); }
  });
}

test('А4: детерминизм — тот же вход и зерно дают те же решения', () => {
  for (const id of ['living-3x4', 'L-5x5', 'studio', 'kitchen-dining', 'hexagon', 'empty-add-living']) {
    const fx = FIX.byId(id); const a = run(fx), b = run(fx);
    a.results.forEach((r, i) => assert.strictEqual(strip(r), strip(b.results[i]), `${id} ${r.conceptKey}`));
  }
});

test('шестиугольник: угловой диван не встаёт в угол 120°, стоит у стены или свободно', () => {
  const fx = FIX.byId('hexagon'); const { prep, results } = run(fx);
  const s = results[0].solutions[0]; const sofa = s.furniture.find(f => f.id === 'sofa');
  const D = AR.describe(sofa, prep.room, AR.mkCtx(prep.room, s.furniture, { productById: H.productById }));
  assert.notStrictEqual(AR.anchorOf(D, prep.room).kind, 'corner');
});

test('отношения замысла влияют на расстановку: must-стена выполнена', () => {
  const fx = FIX.byId('living-3x4'); const { prep, results } = run(fx);
  for (const s of results[0].solutions) {
    const sofa = s.furniture.find(f => f.id === 'sofa'); const D = AR.describe(sofa, prep.room, AR.mkCtx(prep.room, s.furniture, { productById: H.productById }));
    assert.strictEqual(AR.backWall(D, prep.room).wall.label, 'W3');
  }
});

test('предмет на основании едет вместе с перемещённой тумбой', () => {
  const fx = FIX.byId('base-item'); const { results } = run(fx); const s = results[0].solutions[0];
  const ns = s.furniture.find(f => f.id === 'ns'), lamp = s.furniture.find(f => f.id === 'lamp');
  const o = fx.project.furniture; const ons = o.find(f => f.id === 'ns'), olamp = o.find(f => f.id === 'lamp');
  assert.ok(Math.hypot(ns.x - ons.x, ns.y - ons.y) > 1, 'тумба переехала к кровати');
  assert.ok(Math.abs((lamp.x - ns.x) - (olamp.x - ons.x)) < 1.5 && Math.abs((lamp.y - ns.y) - (olamp.y - ons.y)) < 1.5, 'лампа на том же месте тумбы');
});

test('бюджет: строгий режим не превышается, невыполнимый — код BUDGET', () => {
  const fx = FIX.byId('budget-strict-tight'); const { results } = run(fx);
  for (const s of results[0].solutions) assert.ok(s.total <= fx.task.budget.amount + 0.005, `итог ${s.total}`);
  const bad = run(FIX.byId('budget-strict-impossible')); assert.ok(bad.results[0].diagnostics.some(d => d.code === 'BUDGET'));
});

test('предмет «Ничего не делать» за стеной не мешает, перемещаемый — возвращается в комнату', () => {
  const fx = FIX.byId('outside-items'); const { prep, results } = run(fx); const s = results[0].solutions[0];
  const arm = s.furniture.find(f => f.id === 'arm'); const D = AR.describe(arm, prep.room, AR.mkCtx(prep.room, s.furniture, { productById: H.productById }));
  assert.ok(G.insideRoom(D.poly, prep.room.project, prep.room.d));
  assert.deepStrictEqual(s.furniture.find(f => f.id === 'ward'), fx.project.furniture.find(f => f.id === 'ward'));
});
