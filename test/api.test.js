'use strict';
/* Тесты API регистрации, входа и проектов (ТЗ, раздел 12.2). Запуск: npm test
   Каждый набор поднимает ядро API на временной SQLite‑базе — без сети и внешних пакетов. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, fromEnv, ApiError } = require('../server/core/app.js');

const ADMIN = { email: 'admin@test.local', password: 'admin-pass-123' };
const GOOD_PW = 'Kv4rtira-plan';

function makeApp(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-test-'));
  const app = createApp(() => fromEnv({ ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, SEED_DEMO: '0', ...env }, { dataDir: dir }));
  let ipSeq = 0;
  async function call(method, pathname, { body, token, ip, raw } = {}) {
    const buf = raw != null ? Buffer.from(raw) : Buffer.from(body === undefined ? '' : JSON.stringify(body));
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = 'Bearer ' + token;
    return app.handle({
      method, pathname, query: {}, ip: ip || `10.0.0.${++ipSeq % 250}`,
      header: (n) => headers[n.toLowerCase()],
      body: async (limit) => { if (buf.length > limit) throw new ApiError(413, 'too_large', 'too large'); return buf; },
      webRequest: () => null,
    });
  }
  return { app, call, dir };
}

const reg = (over = {}) => ({ name: 'Анна', email: `anna${Math.random().toString(36).slice(2, 8)}@example.com`, password: GOOD_PW, acceptTerms: true, marketing: false, website: '', ...over });
const room = (name = 'Гостиная') => ({ name, vertices: [{ id: 'a', x: 0, y: 0 }], walls: [], openings: [], viewport: { x: 0, y: 0, zoom: 0.1 } });

test('регистрация', async (t) => {
  const { call } = makeApp();

  await t.test('R1: корректные данные → сессия и роль client', async () => {
    const body = reg({ email: 'anna@example.com' });
    const r = await call('POST', '/api/auth/register', { body });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.token, /^[a-f0-9]{64}$/);
    assert.equal(r.body.user.role, 'client');
    assert.equal(r.body.user.name, 'Анна');
    // R13: токен работает
    const me = await call('GET', '/api/auth/me', { token: r.body.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, 'anna@example.com');
  });

  await t.test('R2: та же почта в другом регистре и с пробелом → 409', async () => {
    const r = await call('POST', '/api/auth/register', { body: reg({ email: 'Anna@Example.com ' }) });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'email_taken');
    assert.ok(r.body.error.details.fields.email);
  });

  await t.test('R3: два одинаковых запроса одновременно → один 200, один 409', async () => {
    const body = reg({ email: 'twin@example.com' });
    const rs = await Promise.all([call('POST', '/api/auth/register', { body }), call('POST', '/api/auth/register', { body })]);
    assert.deepEqual(rs.map(r => r.status).sort(), [200, 409]);
  });

  await t.test('R4: role:admin в теле игнорируется', async () => {
    const r = await call('POST', '/api/auth/register', { body: reg({ role: 'admin' }) });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.role, 'client');
  });

  await t.test('R5: плохие пароли → 422 с полем password', async () => {
    for (const password of ['short7!', 'x'.repeat(129), 'samepass@example.com', 'password1', 'qwertyuiop']) {
      const email = password.includes('@') ? password : undefined;
      const r = await call('POST', '/api/auth/register', { body: reg({ password, ...(email ? { email } : {}) }) });
      assert.equal(r.status, 422, password);
      assert.ok(r.body.error.details.fields.password, password);
    }
  });

  await t.test('R6: без согласия → 422 acceptTerms', async () => {
    for (const acceptTerms of [undefined, false, 'true']) {
      const r = await call('POST', '/api/auth/register', { body: reg({ acceptTerms }) });
      assert.equal(r.status, 422);
      assert.ok(r.body.error.details.fields.acceptTerms);
    }
  });

  await t.test('R7: плохие имена → 422 name', async () => {
    for (const name of ['   ', 'я'.repeat(61), '<script>', '12345']) {
      const r = await call('POST', '/api/auth/register', { body: reg({ name }) });
      assert.equal(r.status, 422, name);
      assert.ok(r.body.error.details.fields.name, name);
    }
  });

  await t.test('R8: ловушка для ботов → 422 rejected, пользователь не создан', async () => {
    const body = reg({ email: 'bot@example.com', website: 'http://spam' });
    const r = await call('POST', '/api/auth/register', { body });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'rejected');
    const again = await call('POST', '/api/auth/register', { body: { ...body, website: '' } });
    assert.equal(again.status, 200);
  });

  await t.test('R11: тело больше 16 КБ → 413', async () => {
    const r = await call('POST', '/api/auth/register', { raw: JSON.stringify(reg({ name: 'x'.repeat(20 * 1024) })) });
    assert.equal(r.status, 413);
  });

  await t.test('R12: почта администратора → 409', async () => {
    const r = await call('POST', '/api/auth/register', { body: reg({ email: ADMIN.email }) });
    assert.equal(r.status, 409);
  });

  await t.test('R14: клиент не попадает в админ‑API', async () => {
    const r = await call('POST', '/api/auth/register', { body: reg() });
    const a = await call('POST', '/api/admin/products', { token: r.body.token, body: {} });
    assert.equal(a.status, 403);
    assert.equal(a.body.error.code, 'forbidden');
  });

  await t.test('некорректный JSON → 400', async () => {
    const r = await call('POST', '/api/auth/register', { raw: '{oops' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'bad_json');
  });
});

test('R9: 6‑я попытка регистрации с одного IP за час → 429 и Retry-After', async () => {
  const { call } = makeApp();
  const ip = '192.168.1.7';
  for (let i = 0; i < 5; i++) assert.notEqual((await call('POST', '/api/auth/register', { body: reg(), ip })).status, 429);
  const r = await call('POST', '/api/auth/register', { body: reg(), ip });
  assert.equal(r.status, 429);
  assert.equal(r.body.error.code, 'rate_limited');
  assert.ok(Number(r.headers['Retry-After']) > 0);
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.equal((await call('POST', '/api/auth/register', { body: reg(), ip: '192.168.1.8' })).status, 200);
});

test('R10: REGISTRATION_ENABLED=0 → 403, конфиг сообщает о закрытой регистрации', async () => {
  const { call } = makeApp({ REGISTRATION_ENABLED: '0', CONTACT_EMAIL: 'hello@example.com' });
  const r = await call('POST', '/api/auth/register', { body: reg() });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'registration_closed');
  const c = await call('GET', '/api/config');
  assert.equal(c.body.registration, false);
  assert.equal(c.body.contactEmail, 'hello@example.com');
  assert.equal(typeof c.body.termsVersion, 'string');
});

test('вход: лимит неверных попыток и сброс после успеха', async () => {
  const { call } = makeApp();
  const ip = '172.16.0.5';
  const email = 'lim@example.com';
  assert.equal((await call('POST', '/api/auth/register', { body: reg({ email }), ip: '172.16.0.99' })).status, 200);
  for (let i = 0; i < 9; i++) assert.equal((await call('POST', '/api/auth/login', { body: { email, password: 'wrong-' + i }, ip })).status, 401);
  // успешный вход сбрасывает счётчик пары IP + почта
  assert.equal((await call('POST', '/api/auth/login', { body: { email: ' LIM@example.com', password: GOOD_PW }, ip })).status, 200);
  for (let i = 0; i < 10; i++) assert.equal((await call('POST', '/api/auth/login', { body: { email, password: 'bad' }, ip })).status, 401);
  const r = await call('POST', '/api/auth/login', { body: { email, password: GOOD_PW }, ip });
  assert.equal(r.status, 429, '11-я попытка после 10 неудачных блокируется даже с верным паролем');
  // с другого адреса вход работает
  assert.equal((await call('POST', '/api/auth/login', { body: { email, password: GOOD_PW }, ip: '172.16.0.6' })).status, 200);
});

test('проекты в аккаунте', async (t) => {
  const { call } = makeApp();
  const a = (await call('POST', '/api/auth/register', { body: reg() })).body.token;
  const b = (await call('POST', '/api/auth/register', { body: reg() })).body.token;
  let id;

  await t.test('без входа → 401', async () => {
    assert.equal((await call('GET', '/api/projects')).status, 401);
  });
  await t.test('создание, список, чтение', async () => {
    const c = await call('POST', '/api/projects', { token: a, body: { name: '  Гостиная  ', data: room() } });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal(c.body.rev, 1);
    assert.equal(c.body.name, 'Гостиная');
    id = c.body.id;
    const l = await call('GET', '/api/projects', { token: a });
    assert.equal(l.body.projects.length, 1);
    assert.equal(l.body.projects[0].data, undefined);
    const g = await call('GET', '/api/projects/' + id, { token: a });
    assert.equal(g.body.data.vertices.length, 1);
  });
  await t.test('чужой проект → 404', async () => {
    assert.equal((await call('GET', '/api/projects/' + id, { token: b })).status, 404);
    assert.equal((await call('PUT', '/api/projects/' + id, { token: b, body: { rev: 1, data: room() } })).status, 404);
    assert.equal((await call('GET', '/api/projects', { token: b })).body.projects.length, 0);
  });
  await t.test('сохранение с версией и конфликт', async () => {
    const u = await call('PUT', '/api/projects/' + id, { token: a, body: { rev: 1, data: room('Спальня'), name: 'Спальня' } });
    assert.equal(u.status, 200);
    assert.equal(u.body.rev, 2);
    const stale = await call('PUT', '/api/projects/' + id, { token: a, body: { rev: 1, data: room() } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'conflict');
    assert.equal(stale.body.error.details.rev, 2);
  });
  await t.test('проверка данных', async () => {
    assert.equal((await call('POST', '/api/projects', { token: a, body: { name: 'x', data: { walls: [] } } })).status, 422);
    assert.equal((await call('POST', '/api/projects', { token: a, body: { name: 'x'.repeat(81), data: room() } })).status, 422);
    const big = room(); big.furniture = [{ blob: 'x'.repeat(2.1 * 1024 * 1024) }];
    assert.equal((await call('POST', '/api/projects', { token: a, body: { name: 'big', data: big } })).status, 413);
  });
  await t.test('удаление', async () => {
    assert.equal((await call('DELETE', '/api/projects/' + id, { token: a })).status, 200);
    assert.equal((await call('GET', '/api/projects/' + id, { token: a })).status, 404);
  });
});

test('администратор входит, как раньше', async () => {
  const { call } = makeApp();
  const r = await call('POST', '/api/auth/login', { body: ADMIN });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.role, 'admin');
  assert.equal((await call('GET', '/api/admin/stats', { token: r.body.token })).status, 200);
});
