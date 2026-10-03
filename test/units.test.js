'use strict';
/* Единицы измерения: fmt, fmtU, parseLen, m2 (public/js/editor/core/units.js) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore, rect } = require('./helpers/editor-core.js');

const c = loadCore(); c.setProject(rect());
const fmt = (mm, unit) => c.call('fmt', mm, unit);
const parse = (s, unit) => c.ev(`(() => { const v = parseLen(${JSON.stringify(s)}, ${JSON.stringify(unit)}); return Number.isNaN(v) ? 'NaN' : v; })()`);

test('fmt: миллиметры, сантиметры, метры, дюймы', () => {
  assert.equal(fmt(2500, 'mm'), '2500');
  assert.equal(fmt(2500, 'cm'), '250');
  assert.equal(fmt(2505, 'cm'), '250.5');
  assert.equal(fmt(2500, 'm'), '2.5');
  assert.equal(fmt(1234, 'm'), '1.234');
  assert.equal(fmt(254, 'in'), '10');
  assert.equal(fmt(0, 'mm'), '0');
});
test('fmt: хвостовые нули отбрасываются, целые остаются целыми', () => {
  assert.equal(fmt(1000, 'm'), '1');
  assert.equal(fmt(100, 'cm'), '10');
  assert.equal(fmt(3000, 'm'), '3');
});
test('fmt: футы и дюймы с восьмыми долями', () => {
  assert.equal(fmt(304.8, 'ftin'), "1'");
  assert.equal(fmt(3048, 'ftin'), "10'");
  assert.equal(fmt(304.8 + 25.4 * 6, 'ftin'), `1'6"`);
  assert.equal(fmt(25.4 * 6.5, 'ftin'), `0'6 1/2"`);
  assert.equal(fmt(25.4 * 11.99, 'ftin'), "1'", '11,99 дюйма округляется до фута, а не до 12 дюймов');
});
test('fmt и fmtU по умолчанию берут единицу проекта', () => {
  assert.equal(c.ev('fmt(1500)'), '1500');
  assert.equal(c.ev('fmtU(1500)'), '1500 мм');
  c.run("P.unit = 'cm'");
  assert.equal(c.ev('fmtU(1500)'), '150 см');
  c.run("P.unit = 'mm'");
});
test('parseLen: целые и дробные, запятая как разделитель, пробелы', () => {
  assert.equal(parse('2500', 'mm'), 2500);
  assert.equal(parse('250', 'cm'), 2500);
  assert.equal(parse('2,5', 'm'), 2500);
  assert.equal(parse(' 2.5 ', 'm'), 2500);
  assert.equal(parse('10', 'in'), 254);
  assert.equal(parse('0.5', 'mm'), 1, 'результат всегда целые миллиметры');
});
test('parseLen: футы‑дюймы в разных записях', () => {
  assert.equal(parse("10'", 'ftin'), 3048);
  assert.equal(parse(`1'6"`, 'ftin'), 457);
  assert.equal(parse('1 6', 'ftin'), 457);
  assert.equal(parse(`0'6 1/2"`, 'ftin'), 165);
});
test('parseLen: пустая строка и мусор → NaN', () => {
  for (const s of ['', '   ', 'abc', '12abc', '1..2', '--5', 'Infinity']) assert.equal(parse(s, 'mm'), 'NaN', JSON.stringify(s));
  assert.equal(parse("abc'", 'ftin'), 'NaN');
});
test('туда‑обратно: parseLen(fmt(x)) возвращает x', () => {
  for (const unit of ['mm', 'cm', 'm']) for (const mm of [100, 150, 800, 1234, 2700, 5400, 50000]) assert.equal(parse(fmt(mm, unit), unit), mm, `${mm} ${unit}`);
  for (const mm of [254, 2540, 304.8 * 9]) assert.ok(Math.abs(parse(fmt(mm, 'in'), 'in') - mm) <= 1);
});
test('m2: площадь в квадратных метрах с двумя знаками', () => {
  assert.equal(c.call('m2', 21060000), '21.06 м²');
  assert.equal(c.call('m2', 0), '0.00 м²');
});
test('константы ограничений', () => {
  assert.deepEqual(c.ev('[MIN_WALL, MAX_WALL, MIN_H, MAX_H, MIN_T, MAX_T]'), [100, 50000, 1000, 10000, 50, 1000]);
  assert.deepEqual(c.ev('Object.keys(UNITS)'), ['mm', 'cm', 'm', 'in', 'ftin']);
});
