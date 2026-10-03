'use strict';
/* История и применение изменений: apply, snapshot, undo, redo (public/js/editor/core/history.js) */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore, rect, doorAt } = require('./helpers/editor-core.js');

const c = loadCore();

test('apply: допустимое изменение применяется, обновляет производные данные и историю', () => {
  c.setProject(rect(5400, 3900));
  assert.equal(c.apply('Q.vertices[1].x = 6000; Q.vertices[2].x = 6000;'), null);
  assert.equal(c.ev("D.W.get('w0').len"), 6000);
  assert.deepEqual(c.ev('[hist.length, hi]'), [2, 1]);
});
test('apply: недопустимое изменение возвращает ошибку и не меняет проект и историю', () => {
  c.setProject(rect(5400, 3900));
  const before = c.ev('JSON.stringify(P)');
  assert.match(c.apply('Q.vertices[1].x = 50;'), /Стена короче/);
  assert.equal(c.ev('JSON.stringify(P)'), before);
  assert.deepEqual(c.ev('[hist.length, hi]'), [1, 0]);
});
test('apply: функция может сама вернуть текст ошибки', () => {
  c.setProject(rect());
  assert.equal(c.ev("apply(Q => 'своя ошибка')"), 'своя ошибка');
  assert.equal(c.ev('hist.length'), 1);
});
test('apply работает с копией: мутация Q до ошибки не просачивается в P', () => {
  c.setProject(rect(5400, 3900));
  c.apply("Q.name = 'испорчено'; Q.vertices[1].x = 50;");
  assert.equal(c.ev('P.name'), 'Тест');
});
test('apply с noHist не добавляет шаг истории', () => {
  c.setProject(rect());
  assert.equal(c.apply("Q.name = 'Новое имя';", '{ noHist: true }'), null);
  assert.deepEqual(c.ev('[P.name, hist.length]'), ['Новое имя', 1]);
});
test('apply обновляет updatedAt и вызывает отрисовку', () => {
  c.setProject(rect()); c.run("P.updatedAt = '2000-01-01T00:00:00.000Z'; __calls.render = 0;");
  c.apply("Q.name = 'A';");
  assert.ok(c.ev('P.updatedAt') > '2026');
  assert.equal(c.ev('__calls.render'), 1);
});
test('undo и redo проходят по шагам; на границах ничего не происходит', () => {
  c.setProject(rect(5400, 3900));
  c.apply('Q.vertices[1].x = 6000; Q.vertices[2].x = 6000;');
  c.apply("Q.openings.push(" + JSON.stringify(doorAt('d', 'w0', 500)) + ");");
  assert.deepEqual(c.ev("[D.W.get('w0').len, P.openings.length]"), [6000, 1]);
  c.run('undo()'); assert.deepEqual(c.ev("[D.W.get('w0').len, P.openings.length]"), [6000, 0]);
  c.run('undo()'); assert.deepEqual(c.ev("[D.W.get('w0').len, P.openings.length]"), [5400, 0]);
  c.run('undo()'); assert.equal(c.ev('hi'), 0, 'дальше начала отменять нечего');
  c.run('redo(); redo();'); assert.deepEqual(c.ev("[D.W.get('w0').len, P.openings.length]"), [6000, 1]);
  c.run('redo()'); assert.equal(c.ev('hi'), 2);
});
test('новое изменение после отмены отбрасывает «будущее»', () => {
  c.setProject(rect());
  c.apply("Q.name = 'A';"); c.apply("Q.name = 'B';");
  c.run('undo()');
  c.apply("Q.name = 'C';");
  assert.deepEqual(c.ev('[hist.length, hi, P.name]'), [3, 2, 'C']);
  c.run('redo()'); assert.equal(c.ev('P.name'), 'C');
});
test('история хранит не больше 100 шагов', () => {
  c.setProject(rect());
  for (let i = 0; i < 130; i++) c.apply(`Q.name = 'N${i}';`);
  assert.deepEqual(c.ev('[hist.length, hi, P.name]'), [100, 99, 'N129']);
});
test('отмена сбрасывает выделение', () => {
  c.setProject(rect()); c.apply("Q.name = 'A';"); c.run("E.sel = { type: 'wall', id: 'w0' }; undo();");
  assert.equal(c.ev('E.sel'), null);
});
test('load: читает проект из localStorage, битые данные → null', () => {
  c.run("localStorage.setItem('roomEditor.project', JSON.stringify({ vertices: [], name: 'X' }))");
  assert.equal(c.ev('load().name'), 'X');
  c.run("localStorage.setItem('roomEditor.project', '{broken')"); assert.equal(c.ev('load()'), null);
  c.run("localStorage.setItem('roomEditor.project', JSON.stringify({ name: 'без вершин' }))"); assert.equal(c.ev('load()'), null);
  c.run("localStorage.removeItem('roomEditor.project')"); assert.equal(c.ev('load()'), null);
});

/* Режим просмотра (поддержка открывает чужой проект): ничего не меняется и не попадает в localStorage */
test('режим просмотра: apply отклоняет изменения, история и проект не меняются', () => {
  const v = loadCore();
  v.setProject(rect(5400, 3900));
  const before = v.ev('JSON.stringify(P)');
  v.run('READONLY = true');
  assert.equal(v.apply('Q.vertices[1].x = 6000; Q.vertices[2].x = 6000;'), v.ev('READONLY_MSG'));
  assert.match(v.ev('READONLY_MSG'), /просмотр/i);
  assert.equal(v.ev('JSON.stringify(P)'), before);
  assert.deepEqual(v.ev('[hist.length, hi]'), [1, 0]);
});
test('режим просмотра: save не пишет в localStorage — ни сразу, ни отложенно', () => {
  const v = loadCore();
  const timers = [];
  v.ctx.setTimeout = (fn) => { timers.push(fn); return timers.length; };
  v.setProject(rect(5400, 3900));
  v.run('save()');                       // обычный режим: запись запланирована…
  v.run('READONLY = true');              // …но просмотр включился раньше, чем сработал таймер
  timers.splice(0).forEach((fn) => fn());
  assert.equal(v.ev("localStorage.getItem('roomEditor.project')"), null);
  v.run('save()');
  assert.equal(timers.length, 0, 'в режиме просмотра запись даже не планируется');
  v.run('READONLY = false; save()');
  timers.splice(0).forEach((fn) => fn());
  assert.equal(v.ev("JSON.parse(localStorage.getItem('roomEditor.project')).name"), 'Тест');
});
test('режим просмотра: отмена и повтор не срабатывают', () => {
  const v = loadCore();
  v.setProject(rect(5400, 3900));
  v.apply('Q.vertices[1].x = 6000; Q.vertices[2].x = 6000;');
  v.run('READONLY = true; undo();');
  assert.equal(v.ev("D.W.get('w0').len"), 6000);
});
