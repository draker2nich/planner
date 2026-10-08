'use strict';
/* Сводка расходов ИИ‑дизайнера в админ‑панели: агрегирование журнала, цены из окружения, учёт кэша. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp } = require('./helpers.js');
const { readPrices, costOf } = require('../core/ai-usage.js');

test('цены: общие и по моделям; без цен стоимость не считается', () => {
  assert.equal(readPrices({}).any, false);
  const p = readPrices({ AI_PRICE_IN: '2', AI_PRICE_OUT: '10', AI_PRICES: '{"big":{"in":5,"out":25,"cacheRead":0.2}}', AI_PRICE_CURRENCY: 'EUR' });
  assert.deepEqual([p.any, p.currency], [true, 'EUR']);
  assert.deepEqual(p.of('big'), { in: 5, out: 25, cacheRead: 0.2, cacheWrite: 1.25 });
  assert.deepEqual(p.of('other'), { in: 2, out: 10, cacheRead: 0.1, cacheWrite: 1.25 });
  assert.equal(readPrices({ AI_PRICES: 'не json' }).any, false);
  /* 1 млн обычного ввода + 1 млн из кэша + 1 млн вывода */
  assert.equal(costOf(p.of('other'), { in: 2e6, out: 1e6, cacheRead: 1e6, cacheWrite: 0 }), 2 + 0.2 + 10);
  assert.equal(costOf(null, { in: 1, out: 1, cacheRead: 0, cacheWrite: 0 }), null);
});

test('сводка: по дням, шагам и пользователям; ошибки и кэш учтены; доступ только администратору', async (t) => {
  const A = await makeApp({ AI_MOCK: '1', AI_PRICES: '{"big":{"in":10,"out":50},"small":{"in":1,"out":5}}' }); t.after(A.close);
  const u = await A.user('u@test.dev'), adm = await A.user('root@test.dev', { role: 'admin' });
  const log = (userId, step, data, at) => A.ctx.db.run('INSERT INTO audit_log (user_id, action, entity, entity_id, data, at) VALUES (?,?,?,?,?,?)', [userId, 'ai.' + step, 'ai', null, JSON.stringify(data), at]);
  const today = new Date().toISOString(), yesterday = new Date(Date.now() - 864e5).toISOString(), old = new Date(Date.now() - 40 * 864e5).toISOString();
  await log(u.id, 'taste', { in: 1000, out: 100, ms: 900, model: 'small' }, today);
  await log(u.id, 'concept', { in: 3000, out: 500, cr: 2000, ms: 4000, model: 'big' }, today);
  await log(u.id, 'layout', { in: 4000, out: 600, cw: 1000, ms: 5000, model: 'big' }, today);
  await log(u.id, 'layout', { error: 'ai_busy', ms: 300 }, today);
  await log(adm.id, 'concept', { in: 2000, out: 400, ms: 3000, model: 'big' }, yesterday);
  await log(u.id, 'concept', { in: 9e6, out: 9e6, model: 'big' }, old); // за пределами периода
  await A.ctx.audit(adm.id, 'publish', 'product', 'x', {});              // не ИИ — в сводку не попадает

  assert.equal((await A.call('GET', '/api/admin/ai/usage', null, u.token)).status, 403);
  const r = (await A.call('GET', '/api/admin/ai/usage', null, adm.token, { days: '30' })).body;
  assert.deepEqual([r.days, r.priced, r.currency, r.runs], [30, true, 'USD', 2]);
  assert.deepEqual([r.total.calls, r.total.errors, r.total.in, r.total.out, r.total.cacheRead, r.total.cacheWrite], [5, 1, 10000, 1600, 2000, 1000]);
  /* small: 1000×1 + 100×5; big сегодня: (1000 + 2000×0,1)×10 + 500×50 и (3000 + 1000×1,25)×10 + 600×50; big вчера: 2000×10 + 400×50 */
  const expect = (1000 * 1 + 100 * 5 + (1000 + 200) * 10 + 500 * 50 + (3000 + 1250) * 10 + 600 * 50 + 2000 * 10 + 400 * 50) / 1e6;
  assert.ok(Math.abs(r.total.cost - expect) < 1e-9, `стоимость ${r.total.cost} ≠ ${expect}`);
  assert.equal(r.byDay.length, 2); assert.ok(r.byDay[0].day > r.byDay[1].day, 'свежие дни сверху');
  assert.deepEqual([r.byDay[0].calls, r.byDay[0].errors], [4, 1]);
  assert.deepEqual(r.bySteps.map(s => s.step + ':' + s.model + ':' + s.calls), ['taste:small:1', 'concept:big:2', 'layout::1', 'layout:big:1']);
  assert.deepEqual(r.topUsers.map(x => x.email), ['u@test.dev', 'root@test.dev']);
  assert.equal((await A.call('GET', '/api/admin/ai/usage', null, adm.token, { days: '1' })).body.byDay.length <= 2, true);
  assert.equal((await A.call('GET', '/api/admin/ai/usage', null, adm.token, { days: '9999' })).body.days, 90, 'глубина ограничена');
});

test('сводка без цен: только токены; обращения заглушки стоят ноль', async (t) => {
  const A = await makeApp({ AI_MOCK: '1' }); t.after(A.close);
  const adm = await A.user('root@test.dev', { role: 'admin' });
  await A.ctx.db.run('INSERT INTO audit_log (user_id, action, entity, entity_id, data, at) VALUES (?,?,?,?,?,?)', [adm.id, 'ai.concept', 'ai', null, JSON.stringify({ in: 5, out: 7, model: 'm' }), new Date().toISOString()]);
  const r = (await A.call('GET', '/api/admin/ai/usage', null, adm.token)).body;
  assert.deepEqual([r.priced, r.total.cost, r.total.in, r.total.out], [false, null, 5, 7]);
});
