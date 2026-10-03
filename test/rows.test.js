'use strict';
/* Ряды одинаковых окон (public/js/editor/core/rows.js) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore, rect, windowAt, doorAt } = require('./helpers/editor-core.js');

const c = loadCore();
const row = (n, width, offs, layout, wallId = 'w0') => offs.map((o, k) => windowAt('r' + k, wallId, o, width, { group: 'g1', groupLayout: layout }));
const offsets = (wallId = 'w0') => c.ev(`wallOpenings('${wallId}').map(o => o.offset)`);

test('evenOffsets: 4 окна по 1000 на стене 5400 → простенки по 280', () => {
  assert.deepEqual(c.call('evenOffsets', 5400, 4, 1000), { gap: 280, offs: [280, 1560, 2840, 4120] });
});
test('evenOffsets: одно окно встаёт по центру', () => assert.deepEqual(c.call('evenOffsets', 5400, 1, 1000).offs, [2200]));
test('evenOffsets: простенки между окнами и до углов равны при любом числе окон', () => {
  for (const [L, n, w] of [[5400, 2, 1200], [6000, 3, 900], [7300, 5, 800], [3900, 2, 1400]]) {
    const { offs } = c.call('evenOffsets', L, n, w);
    const gaps = [offs[0], ...offs.slice(1).map((o, k) => o - offs[k] - w), L - offs[n - 1] - w];
    assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, `${L}/${n}/${w}: ${gaps}`);
  }
});
test('evenOffsets: окна не помещаются → отрицательный простенок', () => assert.ok(c.call('evenOffsets', 5400, 6, 1000).gap < 0));
test('gapOffsets: ряд с заданным простенком от начала', () => assert.deepEqual(c.call('gapOffsets', 500, 3, 900, 600), [500, 2000, 3500]));
test('nWin: склонение «окно, окна, окон»', () => {
  assert.deepEqual([1, 2, 4, 5, 11, 12, 21, 22, 25].map((n) => c.call('nWin', n)), ['1 окно', '2 окна', '4 окна', '5 окон', '11 окон', '12 окон', '21 окно', '22 окна', '25 окон']);
});
test('rowOf: окна ряда по порядку; окно без ряда — само по себе', () => {
  c.setProject(rect(5400, 3900, { openings: [...row(3, 900, [3500, 500, 2000], 'gap'), doorAt('d', 'w2', 500)] }));
  assert.deepEqual(c.ev("rowOf(P.openings[0]).map(o => o.offset)"), [500, 2000, 3500]);
  assert.deepEqual(c.ev("rowOf(P.openings.find(o => o.id === 'd')).map(o => o.id)"), ['d']);
  assert.deepEqual(c.ev('rowOf(null)'), []);
});
test('rowGaps, rowUniformGap, rowSpan', () => {
  c.setProject(rect(5400, 3900, { openings: row(3, 900, [500, 2000, 3500], 'gap') }));
  assert.deepEqual(c.ev('rowGaps(rowOf(P.openings[0]))'), [600, 600]);
  assert.equal(c.ev('rowUniformGap(rowOf(P.openings[0]))'), 600);
  assert.equal(c.ev('rowSpan(rowOf(P.openings[0]))'), 3900);
  c.setProject(rect(5400, 3900, { openings: row(3, 900, [500, 2000, 3700], 'gap') }));
  assert.equal(c.ev('rowUniformGap(rowOf(P.openings[0]))'), null, 'разные простенки');
});
test('relayoutRow: смена ширины в равномерном ряду перераспределяет окна', () => {
  c.setProject(rect(5400, 3900, { openings: row(4, 1000, [280, 1560, 2840, 4120], 'even') }));
  assert.equal(c.apply("relayoutRow(Q, 'g1', { width: 800 })"), null);
  assert.deepEqual(offsets(), [440, 1680, 2920, 4160]);
  assert.deepEqual(c.ev('P.openings.map(o => o.width)'), [800, 800, 800, 800]);
});
test('relayoutRow: ряд с простенком сохраняет начало и простенок при смене ширины', () => {
  c.setProject(rect(5400, 3900, { openings: row(3, 900, [500, 2000, 3500], 'gap') }));
  assert.equal(c.apply("relayoutRow(Q, 'g1', { width: 700 })"), null);
  assert.deepEqual(offsets(), [500, 1800, 3100]);
});
test('relayoutRow: новый простенок и новое начало переводят ряд в режим «с простенком»', () => {
  c.setProject(rect(5400, 3900, { openings: row(3, 900, [675, 2250, 3825], 'even') }));
  assert.equal(c.apply("relayoutRow(Q, 'g1', { start: 100, gap: 300 })"), null);
  assert.deepEqual(offsets(), [100, 1300, 2500]);
  assert.deepEqual(c.ev('P.openings.map(o => o.groupLayout)'), ['gap', 'gap', 'gap']);
});
test('relayoutRow: возврат к равномерной расстановке', () => {
  c.setProject(rect(5400, 3900, { openings: row(3, 900, [100, 1300, 2500], 'gap') }));
  assert.equal(c.apply("relayoutRow(Q, 'g1', { layout: 'even' })"), null);
  assert.deepEqual(offsets(), [675, 2250, 3825]);
});
test('ряд, который после изменения не помещается, отклоняется целиком', () => {
  c.setProject(rect(5400, 3900, { openings: row(3, 900, [500, 2000, 3500], 'gap') }));
  assert.match(c.apply("relayoutRow(Q, 'g1', { gap: 1500 })"), /не помещается на стене/);
  assert.deepEqual(offsets(), [500, 2000, 3500], 'проект не изменился');
});
test('ряд не может наехать на дверь той же стены', () => {
  c.setProject(rect(5400, 3900, { openings: [...row(2, 900, [500, 2000], 'gap'), doorAt('d', 'w0', 4000, 800)] }));
  assert.match(c.apply("relayoutRow(Q, 'g1', { start: 2200 })"), /пересекает/);
});
test('leaveRow: окно выходит из ряда, остальные остаются на месте в режиме «с простенком»', () => {
  c.setProject(rect(5400, 3900, { openings: row(4, 1000, [280, 1560, 2840, 4120], 'even') }));
  assert.equal(c.apply("leaveRow(Q, 'r1')"), null);
  assert.equal(c.ev("P.openings.find(o => o.id === 'r1').group"), undefined);
  assert.deepEqual(c.ev("P.openings.filter(o => o.group).map(o => [o.id, o.groupLayout])"), [['r0', 'gap'], ['r2', 'gap'], ['r3', 'gap']]);
  assert.deepEqual(offsets(), [280, 1560, 2840, 4120]);
});
test('leaveRow: ряд из двух окон после выхода одного распадается', () => {
  c.setProject(rect(5400, 3900, { openings: row(2, 1000, [1000, 3000], 'gap') }));
  assert.equal(c.apply("leaveRow(Q, 'r0')"), null);
  assert.deepEqual(c.ev('P.openings.map(o => o.group)'), [null, null]);
});
test('clampOpenings: равномерный ряд перераспределяется при удлинении и укорачивании стены', () => {
  for (const [L, expect] of [[6000, [400, 1800, 3200, 4600]], [4800, [160, 1320, 2480, 3640]]]) {
    c.setProject(rect(5400, 3900, { openings: row(4, 1000, [280, 1560, 2840, 4120], 'even') }));
    assert.equal(c.apply(`Q.vertices[1].x = ${L}; Q.vertices[2].x = ${L}; clampOpenings(Q, derive(Q));`), null);
    assert.deepEqual(offsets(), expect, String(L));
  }
});
test('clampOpenings: ряд с простенком сдвигается целиком, чтобы поместиться', () => {
  c.setProject(rect(5400, 3900, { openings: row(2, 1000, [2800, 4300], 'gap') }));
  assert.equal(c.apply('Q.vertices[1].x = 5000; Q.vertices[2].x = 5000; clampOpenings(Q, derive(Q));'), null);
  assert.deepEqual(offsets(), [2500, 4000]);
});
test('clampOpenings: одиночный проём поджимается к концу укороченной стены', () => {
  c.setProject(rect(5400, 3900, { openings: [doorAt('d', 'w0', 4500, 800)] }));
  assert.equal(c.apply('Q.vertices[1].x = 5000; Q.vertices[2].x = 5000; clampOpenings(Q, derive(Q));'), null);
  assert.deepEqual(offsets(), [4200]);
});
test('clampOpenings не трогает проёмы, которые помещаются', () => {
  c.setProject(rect(5400, 3900, { openings: [doorAt('d', 'w0', 500, 800), ...row(2, 900, [2000, 3500], 'gap')] }));
  assert.equal(c.apply('Q.vertices[1].x = 6000; Q.vertices[2].x = 6000; clampOpenings(Q, derive(Q));'), null);
  assert.deepEqual(offsets(), [500, 2000, 3500]);
});
test('ограничения ряда', () => assert.deepEqual(c.ev('[MIN_PIER, DEF_PIER, MAX_ROW]'), [100, 600, 12]));
