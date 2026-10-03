'use strict';
/* Проверка проекта: validateProject (public/js/editor/core/derive.js) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore, rect, base, ring, windowAt, doorAt } = require('./helpers/editor-core.js');

const c = loadCore(); c.setProject(rect());
const check = (p) => c.call('validateProject', p);

test('корректные проекты проходят проверку', () => {
  assert.equal(check(rect()), null);
  assert.equal(check(base({ vertices: [], walls: [] })), null, 'пустой проект');
  const open = rect(); open.walls.pop();
  assert.equal(check(open), null, 'незамкнутая цепочка');
  assert.equal(check(rect(5400, 3900, { openings: [doorAt('d', 'w0', 500), windowAt('a', 'w0', 2000)] })), null);
});
test('стена короче 100 мм', () => assert.match(check(base(ring([[0, 0], [99, 0], [99, 3000], [0, 3000]]))), /Стена короче 100 мм/));
test('стена ровно 100 мм допустима', () => assert.equal(check(base(ring([[0, 0], [100, 0], [100, 3000], [0, 3000]]))), null));
test('стена длиннее 50 м', () => assert.match(check(base(ring([[0, 0], [50001, 0], [50001, 3000], [0, 3000]]))), /Стена длиннее/));
test('три стены в одной точке', () => {
  const p = rect(); p.vertices.push({ id: 'x', x: -2000, y: 0 }); p.walls.push({ id: 'wx', a: 'v0', b: 'x' });
  assert.equal(check(p), 'Точка не может соединять более двух стен');
});
test('самопересечение контура («бабочка»)', () => {
  assert.equal(check(base(ring([[0, 0], [4000, 3000], [4000, 0], [0, 3000]]))), 'Стена пересекает другую стену');
});
test('стена, продолжающая предыдущую по той же прямой назад', () => {
  const p = base({ vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 3000, y: 0 }, { id: 'c', x: 1000, y: 0 }], walls: [{ id: 'w1', a: 'a', b: 'b' }, { id: 'w2', a: 'b', b: 'c' }] });
  assert.match(check(p), /продолжает предыдущую/);
});
test('две стены между одной парой точек', () => {
  const p = base({ vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 3000, y: 0 }], walls: [{ id: 'w1', a: 'a', b: 'b' }, { id: 'w2', a: 'b', b: 'a' }] });
  assert.equal(check(p), 'Две стены совпадают');
});
test('два отдельных куска стен — не одна линия', () => {
  const p = base({ vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 3000, y: 0 }, { id: 'c', x: 0, y: 2000 }, { id: 'd', x: 3000, y: 2000 }], walls: [{ id: 'w1', a: 'a', b: 'b' }, { id: 'w2', a: 'c', b: 'd' }] });
  assert.equal(check(p), 'Контур должен быть одной непрерывной линией');
});
test('проём на несуществующей стене', () => assert.equal(check(rect(5400, 3900, { openings: [doorAt('d', 'nope', 0)] })), 'Проём без стены'));
test('проём с отрицательным отступом', () => assert.match(check(rect(5400, 3900, { openings: [doorAt('d', 'w0', -10)] })), /отступ не может быть отрицательным/));
test('проём выходит за конец стены; вплотную к концу — допустимо', () => {
  assert.match(check(rect(5400, 3900, { openings: [doorAt('d', 'w0', 4700)] })), /не помещается на стене/);
  assert.equal(check(rect(5400, 3900, { openings: [doorAt('d', 'w0', 4600)] })), null);
});
test('проём выше стены', () => assert.match(check(rect(5400, 3900, { openings: [doorAt('d', 'w0', 500, 800, { height: 2800 })] })), /выше стены/));
test('окно: подоконник ниже пола и выход за потолок', () => {
  assert.match(check(rect(5400, 3900, { openings: [windowAt('a', 'w0', 500, 1000, { sill: -1 })] })), /«от пола» < 0/);
  assert.match(check(rect(5400, 3900, { openings: [windowAt('a', 'w0', 500, 1000, { sill: 1400 })] })), /не помещается по высоте/);
  assert.equal(check(rect(5400, 3900, { openings: [windowAt('a', 'w0', 500, 1000, { sill: 1300 })] })), null, '1300 + 1400 = 2700 — ровно под потолок');
});
test('арка: радиус больше половины ширины и больше высоты', () => {
  const arch = (over) => ({ id: 'r', kind: 'arch', name: 'Арка 1', wallId: 'w0', offset: 500, width: 900, height: 2100, radius: 450, ...over });
  assert.equal(check(rect(5400, 3900, { openings: [arch({})] })), null);
  assert.match(check(rect(5400, 3900, { openings: [arch({ radius: 500 })] })), /радиус 0…/);
  assert.match(check(rect(5400, 3900, { openings: [arch({ radius: -1 })] })), /радиус 0…/);
  assert.match(check(rect(5400, 3900, { openings: [arch({ offset: 100, width: 5000, radius: 2400, height: 2300 })] })), /радиус больше высоты/);
});
test('проёмы на одной стене пересекаются; встык — допустимо; на разных стенах — допустимо', () => {
  assert.match(check(rect(5400, 3900, { openings: [doorAt('d', 'w0', 500), windowAt('a', 'w0', 1200)] })), /пересекает/);
  assert.equal(check(rect(5400, 3900, { openings: [doorAt('d', 'w0', 500), windowAt('a', 'w0', 1300)] })), null);
  assert.equal(check(rect(5400, 3900, { openings: [doorAt('d', 'w0', 500), windowAt('a', 'w2', 500)] })), null);
});
test('сообщения используют единицу проекта', () => {
  c.run("P.unit = 'cm'");
  assert.match(check(base(ring([[0, 0], [99, 0], [99, 3000], [0, 3000]]))), /Стена короче 10 см/);
  c.run("P.unit = 'mm'");
});
