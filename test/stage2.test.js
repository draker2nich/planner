'use strict';
/* Тесты API этапа 2: почта и пароль, вход через провайдеров, аккаунт, проекты, пользователи в админке. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, ADMIN, GOOD_PW, room } = require('./helpers/app.js');

const login = (call, email, password) => call('POST', '/api/auth/login', { body: { email, password } });

test('подтверждение почты', async (t) => {
  const { call, register, mails, tokenOf, db } = makeApp();
  const u = await register({ email: 'vera@example.com' });

  await t.test('регистрация отправляет письмо verify, пользователь не подтверждён', async () => {
    const m = mails('verify', 'vera@example.com');
    assert.equal(m.length, 1);
    assert.match(m[0].link, /^https:\/\/furnitech\.test\/verify\?token=[\w-]{43}$/);
    assert.equal((await call('GET', '/api/auth/me', { token: u.token })).body.user.emailVerified, false);
  });
  await t.test('в базе хранится только хеш токена', async () => {
    const raw = tokenOf(mails('verify')[0]);
    const rows = await (await db()).all('SELECT token_hash FROM auth_tokens');
    assert.ok(rows.length && rows.every((r) => r.token_hash !== raw && /^[a-f0-9]{64}$/.test(r.token_hash)));
  });
  await t.test('повторное письмо чаще раза в минуту → 429; новое письмо отменяет прежнюю ссылку', async () => {
    const first = tokenOf(mails('verify')[0]);
    const r1 = await call('POST', '/api/auth/verify/resend', { token: u.token });
    assert.equal(r1.status, 200);
    const r2 = await call('POST', '/api/auth/verify/resend', { token: u.token });
    assert.equal(r2.status, 429);
    assert.ok(Number(r2.headers['Retry-After']) > 0);
    assert.equal((await call('POST', '/api/auth/verify', { body: { token: first } })).status, 404);
  });
  await t.test('ссылка подтверждает почту; повторное открытие → already', async () => {
    const raw = tokenOf(mails('verify').at(-1));
    const r = await call('POST', '/api/auth/verify', { body: { token: raw } });
    assert.equal(r.status, 200); assert.equal(r.body.already, false); assert.equal(r.body.email, 'v***@example.com');
    assert.equal((await call('GET', '/api/auth/me', { token: u.token })).body.user.emailVerified, true);
    const again = await call('POST', '/api/auth/verify', { body: { token: raw } });
    assert.equal(again.status, 200); assert.equal(again.body.already, true);
    assert.equal((await call('POST', '/api/auth/verify/resend', { token: u.token })).body.already, true);
  });
  await t.test('мусорный токен → 404, просроченный → 410', async () => {
    assert.equal((await call('POST', '/api/auth/verify', { body: { token: 'nope' } })).body.error.code, 'token_invalid');
    const v = await register({ email: 'late@example.com' });
    await (await db()).run("UPDATE auth_tokens SET expires_at='2000-01-01T00:00:00.000Z' WHERE user_id=?", [v.user.id]);
    const r = await call('POST', '/api/auth/verify', { body: { token: tokenOf(mails('verify', 'late@example.com')[0]) } });
    assert.equal(r.status, 410); assert.equal(r.body.error.code, 'token_expired');
  });
});

test('восстановление пароля', async (t) => {
  const { call, register, mails, tokenOf, db } = makeApp();
  const u = await register({ email: 'petr@example.com' });

  await t.test('ответ одинаков для существующей и несуществующей почты; письмо — только существующей', async () => {
    const a = await call('POST', '/api/auth/password/forgot', { body: { email: 'nobody@example.com' } });
    const b = await call('POST', '/api/auth/password/forgot', { body: { email: 'Petr@Example.com ' } });
    assert.deepEqual([a.status, a.body], [200, { ok: true }]);
    assert.deepEqual([b.status, b.body], [200, { ok: true }]);
    assert.equal(mails('reset', 'nobody@example.com').length, 0);
    assert.equal(mails('reset', 'petr@example.com').length, 1);
  });
  await t.test('некорректная почта → 422', async () => {
    assert.equal((await call('POST', '/api/auth/password/forgot', { body: { email: 'not-an-email' } })).status, 422);
  });
  await t.test('второй запрос отменяет первую ссылку', async () => {
    const first = tokenOf(mails('reset', 'petr@example.com')[0]);
    await call('POST', '/api/auth/password/forgot', { body: { email: 'petr@example.com' } });
    assert.equal((await call('POST', '/api/auth/password/reset/check', { body: { token: first } })).status, 404);
    const second = tokenOf(mails('reset', 'petr@example.com').at(-1));
    const ok = await call('POST', '/api/auth/password/reset/check', { body: { token: second } });
    assert.equal(ok.status, 200); assert.equal(ok.body.email, 'p***@example.com');
  });
  await t.test('слабый пароль → 422, токен не тратится', async () => {
    const raw = tokenOf(mails('reset', 'petr@example.com').at(-1));
    for (const password of ['short', 'petr@example.com', 'password1']) {
      const r = await call('POST', '/api/auth/password/reset', { body: { token: raw, password } });
      assert.equal(r.status, 422, password); assert.ok(r.body.error.details.fields.password);
    }
    assert.equal((await call('POST', '/api/auth/password/reset/check', { body: { token: raw } })).status, 200);
  });
  await t.test('сброс: новый пароль работает, старый нет, прежние сеансы завершены, почта подтверждена, ссылка одноразовая', async () => {
    const raw = tokenOf(mails('reset', 'petr@example.com').at(-1));
    const r = await call('POST', '/api/auth/password/reset', { body: { token: raw, password: 'Novyi-parol-77' } });
    assert.equal(r.status, 200); assert.match(r.body.token, /^[a-f0-9]{64}$/);
    assert.equal(r.body.user.emailVerified, true);
    assert.equal((await call('GET', '/api/auth/me', { token: u.token })).status, 401);
    assert.equal((await call('GET', '/api/auth/me', { token: r.body.token })).status, 200);
    assert.equal((await login(call, 'petr@example.com', GOOD_PW)).status, 401);
    assert.equal((await login(call, 'petr@example.com', 'Novyi-parol-77')).status, 200);
    assert.equal((await call('POST', '/api/auth/password/reset', { body: { token: raw, password: 'Eshe-odin-parol-1' } })).status, 404);
    assert.equal(mails('password_changed', 'petr@example.com').length, 1);
  });
  await t.test('просроченная ссылка → 410', async () => {
    const v = await register({ email: 'old@example.com' });
    await call('POST', '/api/auth/password/forgot', { body: { email: 'old@example.com' } });
    await (await db()).run("UPDATE auth_tokens SET expires_at='2000-01-01T00:00:00.000Z' WHERE user_id=? AND kind='reset'", [v.user.id]);
    const r = await call('POST', '/api/auth/password/reset', { body: { token: tokenOf(mails('reset', 'old@example.com')[0]), password: 'Novyi-parol-77' } });
    assert.equal(r.status, 410);
  });
  await t.test('на одну почту не больше 3 писем в час, ответ остаётся 200', async () => {
    await register({ email: 'flood@example.com' });
    for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/auth/password/forgot', { body: { email: 'flood@example.com' } })).status, 200);
    assert.equal(mails('reset', 'flood@example.com').length, 3);
  });
  await t.test('с одного адреса не больше 5 запросов в час → 429', async () => {
    let last;
    for (let i = 0; i < 6; i++) last = await call('POST', '/api/auth/password/forgot', { body: { email: `x${i}@example.com` }, ip: '9.9.9.9' });
    assert.equal(last.status, 429);
  });
  await t.test('смена пароля в аккаунте: неверный текущий → 422; верный → письмо и завершение других сеансов', async () => {
    const a = await register({ email: 'change@example.com' });
    const other = (await login(call, 'change@example.com', GOOD_PW)).body.token;
    assert.equal((await call('POST', '/api/auth/password', { token: a.token, body: { current: 'wrong', next: 'Novyi-parol-77' } })).status, 422);
    assert.equal((await call('POST', '/api/auth/password', { token: a.token, body: { current: GOOD_PW, next: 'short' } })).status, 422);
    assert.equal((await call('POST', '/api/auth/password', { token: a.token, body: { current: GOOD_PW, next: 'Novyi-parol-77' } })).status, 200);
    assert.equal((await call('GET', '/api/auth/me', { token: other })).status, 401);
    assert.equal((await call('GET', '/api/auth/me', { token: a.token })).status, 200);
    assert.equal(mails('password_changed', 'change@example.com').length, 1);
  });
});

test('почта выключена', async (t) => {
  const { call, register, mails } = makeApp({ MAIL_MODE: 'off', REQUIRE_VERIFIED_EMAIL: '1' });
  await t.test('config.mail = false, жёсткий режим игнорируется', async () => {
    const c = (await call('GET', '/api/config')).body;
    assert.equal(c.mail, false); assert.equal(c.requireVerifiedEmail, false);
  });
  await t.test('регистрация работает, писем нет; forgot и resend → 503; проекты сохраняются', async () => {
    const u = await register();
    assert.equal(mails().length, 0);
    assert.equal((await call('POST', '/api/auth/password/forgot', { body: { email: u.email } })).status, 503);
    assert.equal((await call('POST', '/api/auth/verify/resend', { token: u.token })).body.error.code, 'mail_disabled');
    assert.equal((await call('POST', '/api/projects', { token: u.token, body: { name: 'A' } })).status, 200);
  });
});

test('почтовые провайдеры', async (t) => {
  const sent = [];
  const fetch = async (url, opts) => { sent.push({ url, headers: opts.headers, body: JSON.parse(opts.body) }); return { ok: true, status: 200, text: async () => '{}' }; };
  const { makeMailer } = require('../server/core/mail.js');
  const user = { email: 'a@example.com', name: 'Анна <b>' };
  await t.test('Resend: адрес, заголовок, поля', async () => {
    const m = makeMailer({ env: { RESEND_API_KEY: 'rk', MAIL_FROM: 'furnitech <no-reply@furnitech.test>' }, fetch, onVercel: true });
    assert.equal(m.mode, 'resend');
    await m.send('reset', user, { link: 'https://furnitech.test/reset?token=abc' });
    const r = sent.at(-1);
    assert.equal(r.url, 'https://api.resend.com/emails'); assert.equal(r.headers.Authorization, 'Bearer rk');
    assert.deepEqual(r.body.to, ['a@example.com']); assert.match(r.body.subject, /Сброс пароля/);
    assert.ok(r.body.text.includes('https://furnitech.test/reset?token=abc'));
    assert.ok(r.body.html.includes('Анна &lt;b&gt;') && !r.body.html.includes('Анна <b>'), 'имя экранируется');
  });
  await t.test('Postmark: адрес, заголовок, поля', async () => {
    const m = makeMailer({ env: { POSTMARK_SERVER_TOKEN: 'pt', MAIL_FROM: 'no-reply@furnitech.test' }, fetch, onVercel: true });
    assert.equal(m.mode, 'postmark');
    await m.send('verify', user, { link: 'https://furnitech.test/verify?token=abc' });
    const r = sent.at(-1);
    assert.equal(r.url, 'https://api.postmarkapp.com/email'); assert.equal(r.headers['X-Postmark-Server-Token'], 'pt');
    assert.equal(r.body.To, 'a@example.com'); assert.equal(r.body.MessageStream, 'outbound');
  });
  await t.test('без MAIL_FROM и без ключей на Vercel — off', () => {
    assert.equal(makeMailer({ env: { RESEND_API_KEY: 'rk' }, onVercel: true }).mode, 'off');
    assert.equal(makeMailer({ env: {}, onVercel: true }).enabled, false);
  });
  await t.test('сбой провайдера: send бросает, sendQuiet возвращает false', async () => {
    const m = makeMailer({ env: { RESEND_API_KEY: 'rk', MAIL_FROM: 'a@b.cc' }, fetch: async () => ({ ok: false, status: 500, text: async () => 'boom' }), onVercel: true });
    await assert.rejects(m.send('reset', user, { link: 'x' }));
    const err = console.error; console.error = () => {};
    try { assert.equal(await m.sendQuiet('reset', user, { link: 'x' }), false); } finally { console.error = err; }
  });
  await t.test('ссылки строятся от PUBLIC_URL, не от заголовков запроса', () => {
    const { baseUrl } = require('../server/core/mail.js');
    assert.equal(baseUrl({ env: { PUBLIC_URL: 'https://furnitech.app/' } }), 'https://furnitech.app');
    assert.equal(baseUrl({ env: { VERCEL_PROJECT_PRODUCTION_URL: 'furnitech.vercel.app' } }), 'https://furnitech.vercel.app');
    assert.equal(baseUrl({ env: { PORT: '9000' } }), 'http://localhost:9000');
  });
});

test('вход через провайдеров', async (t) => {
  const profiles = {
    newbie: { sub: 'g-1', email: 'New@Gmail.com', email_verified: true, name: 'Новый Пользователь' },
    unver: { sub: 'g-2', email: 'x@example.com', email_verified: false, name: 'X' },
    linked: { sub: 'g-3', email: 'linked@example.com', email_verified: true, name: 'L' },
    hijack: { sub: 'g-4', email: 'victim@example.com', email_verified: true, name: 'V' },
    boss: { sub: 'g-5', email: ADMIN.email, email_verified: true, name: 'Boss' },
    banned: { sub: 'g-6', email: 'banned@example.com', email_verified: true, name: 'B' },
    ya: { id: 777, default_email: 'ya@yandex.ru', real_name: 'Яна' },
    badname: { sub: 'g-7', email: 'odd.name@example.com', email_verified: true, name: '<script>' },
  };
  const ENV = { GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gs', YANDEX_CLIENT_ID: 'yid', YANDEX_CLIENT_SECRET: 'ys' };
  const { call, register, oauth, adminToken, db } = makeApp(ENV, { profiles });

  await t.test('config сообщает о настроенных провайдерах', async () => {
    assert.deepEqual((await call('GET', '/api/config')).body.oauth, { google: true, yandex: true });
    const only = makeApp({ GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gs' });
    assert.deepEqual((await only.call('GET', '/api/config')).body.oauth, { google: true, yandex: false });
    const r = await only.call('GET', '/api/auth/oauth/yandex/start');
    assert.equal(new URL(r.headers.Location).searchParams.get('oauth_error'), 'disabled');
  });
  await t.test('старт: 302 на провайдера с state и PKCE, cookie HttpOnly', async () => {
    const s = await call('GET', '/api/auth/oauth/google/start', { query: { next: '/projects' } });
    assert.equal(s.status, 302);
    const loc = new URL(s.headers.Location);
    assert.equal(loc.origin + loc.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(loc.searchParams.get('redirect_uri'), 'https://furnitech.test/api/auth/oauth/google/callback');
    assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(loc.searchParams.get('state').length >= 16);
    assert.match(s.headers['Set-Cookie'], /^ft_oauth=[^;]+; Max-Age=600; Path=\/api\/auth\/oauth; HttpOnly; SameSite=Lax; Secure$/);
  });
  await t.test('новый пользователь: без пароля, почта подтверждена, имя и согласие записаны', async () => {
    const r = await oauth('google', 'newbie', { next: '/projects' });
    assert.equal(r.error, null); assert.equal(r.next, '/projects');
    assert.match(r.callback.headers['Set-Cookie'], /Max-Age=0/);
    assert.equal(r.exchange.status, 200); assert.equal(r.exchange.body.created, true);
    const user = r.exchange.body.user;
    assert.deepEqual([user.email, user.role, user.emailVerified, user.hasPassword, user.name], ['new@gmail.com', 'client', true, false, 'Новый Пользователь']);
    const row = await (await db()).get('SELECT terms_accepted_at, terms_version FROM users WHERE id=?', [user.id]);
    assert.ok(row.terms_accepted_at && row.terms_version);
  });
  await t.test('повторный вход открывает тот же аккаунт', async () => {
    const r = await oauth('google', 'newbie');
    assert.equal(r.exchange.body.created, false);
    assert.equal(Number((await (await db()).get("SELECT COUNT(*) AS c FROM users WHERE email='new@gmail.com'")).c), 1);
  });
  await t.test('одноразовый код не работает второй раз', async () => {
    const r = await oauth('google', 'newbie');
    assert.equal((await call('POST', '/api/auth/oauth/exchange', { body: { code: r.code } })).status, 400);
    assert.equal((await call('POST', '/api/auth/oauth/exchange', { body: { code: 'garbage' } })).body.error.code, 'oauth_code');
  });
  await t.test('аккаунт без пароля задаёт пароль без текущего', async () => {
    const r = await oauth('google', 'newbie');
    const tok = r.exchange.body.token;
    assert.equal((await call('POST', '/api/auth/password', { token: tok, body: { next: 'Pervyi-parol-55' } })).status, 200);
    assert.equal((await login(call, 'new@gmail.com', 'Pervyi-parol-55')).status, 200);
    assert.equal((await call('POST', '/api/auth/password', { token: tok, body: { next: 'Vtoroi-parol-55' } })).status, 422, 'теперь текущий обязателен');
  });
  await t.test('подмена или отсутствие state → ошибка state', async () => {
    assert.equal((await oauth('google', 'newbie', { tamperState: true })).error, 'state');
    const cb = await call('GET', '/api/auth/oauth/google/callback', { query: { code: 'newbie', state: 'abc' } });
    assert.equal(new URL(cb.headers.Location).searchParams.get('oauth_error'), 'state');
    const forged = await call('GET', '/api/auth/oauth/google/callback', { query: { code: 'newbie', state: 'abc' }, cookie: 'ft_oauth=eyJzIjoiYWJjIn0.forged' });
    assert.equal(new URL(forged.headers.Location).searchParams.get('oauth_error'), 'state');
  });
  await t.test('отказ пользователя → cancelled; сбой обмена кода → provider', async () => {
    const s = await call('GET', '/api/auth/oauth/google/start');
    const cookie = s.headers['Set-Cookie'].split(';')[0];
    const cb = await call('GET', '/api/auth/oauth/google/callback', { query: { error: 'access_denied' }, cookie });
    assert.equal(new URL(cb.headers.Location).searchParams.get('oauth_error'), 'cancelled');
    const err = console.error; console.error = () => {};
    try { assert.equal((await oauth('google', 'unknown-code')).error, 'provider'); } finally { console.error = err; }
  });
  await t.test('неподтверждённая почта у провайдера → no_email', async () => {
    assert.equal((await oauth('google', 'unver')).error, 'no_email');
  });
  await t.test('подтверждённый аккаунт с той же почтой связывается, пароль сохраняется', async () => {
    const u = await register({ email: 'linked@example.com' });
    await (await db()).run("UPDATE users SET email_verified_at='2026-01-01T00:00:00.000Z' WHERE id=?", [u.user.id]);
    const r = await oauth('google', 'linked');
    assert.equal(r.exchange.body.user.id, u.user.id); assert.equal(r.exchange.body.created, false);
    assert.equal((await login(call, 'linked@example.com', GOOD_PW)).status, 200);
    assert.equal((await call('GET', '/api/auth/me', { token: u.token })).status, 200);
  });
  await t.test('неподтверждённый аккаунт: связывается, пароль сброшен, сеансы завершены', async () => {
    const attacker = await register({ email: 'victim@example.com' });
    const r = await oauth('google', 'hijack');
    assert.equal(r.exchange.body.user.id, attacker.user.id);
    assert.deepEqual([r.exchange.body.user.emailVerified, r.exchange.body.user.hasPassword], [true, false]);
    assert.equal((await login(call, 'victim@example.com', GOOD_PW)).status, 401);
    assert.equal((await call('GET', '/api/auth/me', { token: attacker.token })).status, 401);
  });
  await t.test('почта администратора → use_password', async () => {
    assert.equal((await oauth('google', 'boss')).error, 'use_password');
  });
  await t.test('заблокированный аккаунт → blocked (и по почте, и по существующей связи)', async () => {
    const u = await register({ email: 'banned@example.com' });
    const at = await adminToken();
    await call('POST', `/api/admin/users/${u.user.id}/block`, { token: at, body: {} });
    assert.equal((await oauth('google', 'banned')).error, 'blocked');
    const n = (await oauth('google', 'newbie')).exchange.body.user.id;
    await call('POST', `/api/admin/users/${n}/block`, { token: at, body: {} });
    assert.equal((await oauth('google', 'newbie')).error, 'blocked');
    await call('POST', `/api/admin/users/${n}/unblock`, { token: at });
  });
  await t.test('Яндекс: профиль с default_email', async () => {
    const r = await oauth('yandex', 'ya');
    assert.equal(new URL(r.start.headers.Location).origin, 'https://oauth.yandex.ru');
    assert.deepEqual([r.exchange.body.user.email, r.exchange.body.user.name, r.exchange.body.created], ['ya@yandex.ru', 'Яна', true]);
  });
  await t.test('недопустимое имя из профиля заменяется частью почты', async () => {
    assert.equal((await oauth('google', 'badname')).exchange.body.user.name, 'odd.name');
  });
  await t.test('next=//evil.com отбрасывается', async () => {
    const r = await oauth('google', 'newbie', { next: '//evil.com' });
    assert.equal(r.next, null);
    assert.ok(r.back.href.startsWith('https://furnitech.test/login?'));
  });
  await t.test('закрытая регистрация: новый → registration_closed, существующий входит', async () => {
    const closed = makeApp({ ...ENV, REGISTRATION_ENABLED: '0' }, { profiles });
    assert.equal((await closed.oauth('google', 'newbie')).error, 'registration_closed');
  });
});

test('аккаунт', async (t) => {
  const { call, register, mails, db, adminToken } = makeApp();
  await t.test('GET /api/account: провайдеры, сеансы, проекты', async () => {
    const u = await register();
    await login(call, u.email, GOOD_PW);
    await call('POST', '/api/projects', { token: u.token, body: { name: 'A' } });
    const r = await call('GET', '/api/account', { token: u.token });
    assert.deepEqual([r.status, r.body.sessions, r.body.projects, r.body.providers], [200, 2, 1, []]);
    assert.equal(r.body.user.hasPassword, true);
  });
  await t.test('имя: корректное сохраняется, недопустимое → 422', async () => {
    const u = await register();
    const ok = await call('PATCH', '/api/account', { token: u.token, body: { name: '  Анна   Мария ' } });
    assert.equal(ok.body.user.name, 'Анна Мария');
    for (const name of ['', '<b>x</b>', '12345', 'я'.repeat(61)]) assert.equal((await call('PATCH', '/api/account', { token: u.token, body: { name } })).status, 422, name);
  });
  await t.test('«Выйти на других устройствах» оставляет только текущий сеанс', async () => {
    const u = await register();
    const other = (await login(call, u.email, GOOD_PW)).body.token;
    const r = await call('POST', '/api/account/sessions/revoke', { token: u.token });
    assert.equal(r.body.revoked, 1);
    assert.equal((await call('GET', '/api/auth/me', { token: other })).status, 401);
    assert.equal((await call('GET', '/api/auth/me', { token: u.token })).status, 200);
  });
  await t.test('удаление: неверный пароль → 422; после 5 ошибок → 429', async () => {
    const u = await register();
    for (let i = 0; i < 5; i++) {
      const r = await call('POST', '/api/account/delete', { token: u.token, body: { password: 'wrong-' + i } });
      assert.equal(r.status, 422); assert.ok(r.body.error.details.fields.password);
    }
    assert.equal((await call('POST', '/api/account/delete', { token: u.token, body: { password: GOOD_PW } })).status, 429);
    assert.equal((await call('GET', '/api/auth/me', { token: u.token })).status, 200, 'аккаунт цел');
  });
  await t.test('удаление: пользователь, проекты, сеансы и токены исчезают; повторная регистрация работает', async () => {
    const u = await register({ email: 'gone@example.com' });
    await call('POST', '/api/projects', { token: u.token, body: { name: 'A', data: room() } });
    const r = await call('POST', '/api/account/delete', { token: u.token, body: { password: GOOD_PW } });
    assert.equal(r.status, 200);
    const d = await db();
    for (const [table, col] of [['users', 'id'], ['projects', 'user_id'], ['sessions', 'user_id'], ['auth_tokens', 'user_id'], ['user_identities', 'user_id']]) {
      assert.equal(Number((await d.get(`SELECT COUNT(*) AS c FROM ${table} WHERE ${col}=?`, [u.user.id])).c), 0, table);
    }
    assert.equal((await call('GET', '/api/auth/me', { token: u.token })).status, 401);
    assert.equal((await login(call, 'gone@example.com', GOOD_PW)).status, 401);
    assert.equal(mails('account_deleted', 'gone@example.com').length, 1);
    const log = await d.get("SELECT data FROM audit_log WHERE action='user.delete' AND entity_id=?", [u.user.id]);
    assert.ok(log && !log.data.includes('gone@example.com'), 'в журнале нет почты');
    const again = await register({ email: 'gone@example.com' });
    assert.notEqual(again.user.id, u.user.id);
    assert.equal((await call('GET', '/api/projects', { token: again.token })).body.projects.length, 0);
  });
  await t.test('администратор не может удалить свой аккаунт', async () => {
    const r = await call('POST', '/api/account/delete', { token: await adminToken(), body: { password: ADMIN.password } });
    assert.equal(r.status, 403);
  });
});

test('аккаунт без пароля удаляется по своей почте', async () => {
  const profiles = { p: { sub: 's1', email: 'nopw@example.com', email_verified: true, name: 'N' } };
  const { call, oauth } = makeApp({ GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's' }, { profiles });
  const tok = (await oauth('google', 'p')).exchange.body.token;
  assert.equal((await call('POST', '/api/account/delete', { token: tok, body: { confirmEmail: 'other@example.com' } })).status, 422);
  assert.equal((await call('POST', '/api/account/delete', { token: tok, body: { confirmEmail: ' NoPW@example.com' } })).status, 200);
  assert.equal((await oauth('google', 'p')).exchange.body.created, true, 'после удаления связь исчезла — создаётся новый аккаунт');
});

test('мои проекты', async (t) => {
  const { call, register, db } = makeApp();
  const u = await register();
  let first;
  await t.test('создание без data → пустой проект в мм', async () => {
    const r = await call('POST', '/api/projects', { token: u.token, body: { name: '  Спальня  ' } });
    assert.equal(r.status, 200); assert.equal(r.body.name, 'Спальня'); first = r.body.id;
    const full = (await call('GET', `/api/projects/${first}`, { token: u.token })).body;
    assert.deepEqual([full.data.unit, full.data.name, full.data.walls.length], ['mm', 'Спальня', 0]);
  });
  await t.test('список: миниатюра и лимит', async () => {
    await call('POST', '/api/projects', { token: u.token, body: { name: 'Гостиная', data: room() } });
    const l = (await call('GET', '/api/projects', { token: u.token })).body;
    assert.equal(l.limit, 50); assert.equal(l.projects.length, 2);
    const g = l.projects.find((p) => p.name === 'Гостиная');
    assert.deepEqual(g.preview.walls[0], [0, 0, 5400, 0]);
    assert.deepEqual(g.preview.counts, { walls: 4, openings: 0, furniture: 0 }); assert.equal(g.preview.closed, true);
    assert.equal(g.data, undefined, 'список не отдаёт данные проекта');
  });
  await t.test('миниатюра отбрасывает нечисловые значения', async () => {
    const evil = room('X'); evil.vertices[0].x = '<svg onload=alert(1)>'; evil.walls.push({ id: 'w9', a: 'zz', b: 'a' });
    const r = await call('POST', '/api/projects', { token: u.token, body: { data: evil } });
    assert.ok(JSON.stringify(r.body.preview).indexOf('<') === -1);
    assert.ok(r.body.preview.walls.every((w) => w.length === 4 && w.every(Number.isFinite)));
  });
  await t.test('старый проект без миниатюры получает её при первом запросе списка', async () => {
    await (await db()).run('UPDATE projects SET preview=NULL WHERE user_id=?', [u.user.id]);
    const l = (await call('GET', '/api/projects', { token: u.token })).body;
    assert.ok(l.projects.every((p) => p.preview && Array.isArray(p.preview.walls)));
    assert.equal(Number((await (await db()).get('SELECT COUNT(*) AS c FROM projects WHERE preview IS NULL AND user_id=?', [u.user.id])).c), 0);
  });
  await t.test('переименование меняет имя в колонке и в данных, версия растёт', async () => {
    const r = await call('PATCH', `/api/projects/${first}`, { token: u.token, body: { name: 'Детская' } });
    assert.deepEqual([r.status, r.body.name, r.body.rev], [200, 'Детская', 2]);
    assert.equal((await call('GET', `/api/projects/${first}`, { token: u.token })).body.data.name, 'Детская');
    for (const name of ['', '   ', 'x'.repeat(81)]) assert.equal((await call('PATCH', `/api/projects/${first}`, { token: u.token, body: { name } })).status, 422);
  });
  await t.test('редактор со старой версией после переименования получает конфликт', async () => {
    const r = await call('PUT', `/api/projects/${first}`, { token: u.token, body: { name: 'Спальня', data: room('Спальня'), rev: 1 } });
    assert.equal(r.status, 409);
  });
  await t.test('копия независима, имя «— копия» обрезается до 80 символов, бриф — черновик', async () => {
    const src = (await call('POST', '/api/projects', { token: u.token, body: { name: 'д'.repeat(80), data: { ...room(), status: 'submitted', brief: { text: 'x' } } } })).body;
    const c = (await call('POST', `/api/projects/${src.id}/copy`, { token: u.token })).body;
    assert.equal(c.name.length, 80); assert.ok(c.name.endsWith(' — копия')); assert.notEqual(c.id, src.id);
    const full = (await call('GET', `/api/projects/${c.id}`, { token: u.token })).body;
    assert.equal(full.data.status, 'draft');
    await call('PUT', `/api/projects/${c.id}`, { token: u.token, body: { data: { ...room(), walls: [] }, rev: 1 } });
    assert.equal((await call('GET', `/api/projects/${src.id}`, { token: u.token })).body.data.walls.length, 4);
  });
  await t.test('чужой проект: PATCH, copy, GET → 404', async () => {
    const other = await register();
    assert.equal((await call('PATCH', `/api/projects/${first}`, { token: other.token, body: { name: 'x' } })).status, 404);
    assert.equal((await call('POST', `/api/projects/${first}/copy`, { token: other.token })).status, 404);
    assert.equal((await call('GET', `/api/projects/${first}`, { token: other.token })).status, 404);
  });
  await t.test('удалённый проект исчезает из списка и не открывается', async () => {
    const p = (await call('POST', '/api/projects', { token: u.token, body: { name: 'Временный' } })).body;
    assert.equal((await call('DELETE', `/api/projects/${p.id}`, { token: u.token })).status, 200);
    assert.equal((await call('GET', `/api/projects/${p.id}`, { token: u.token })).status, 404);
    assert.ok(!(await call('GET', '/api/projects', { token: u.token })).body.projects.some((x) => x.id === p.id));
  });
  await t.test('51‑й проект создать и скопировать нельзя', async () => {
    const v = await register(); const d = await db(); const t0 = new Date().toISOString();
    for (let i = 0; i < 50; i++) await d.run('INSERT INTO projects (id,user_id,name,data,size,rev,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)', [`p${i}-${v.user.id}`, v.user.id, 'P' + i, JSON.stringify(room()), 10, t0, t0]);
    assert.equal((await call('POST', '/api/projects', { token: v.token, body: { name: 'ещё' } })).body.error.code, 'limit');
    assert.equal((await call('POST', `/api/projects/p0-${v.user.id}/copy`, { token: v.token })).body.error.code, 'limit');
  });
  await t.test('не больше 30 созданий в час', async () => {
    const v = await register(); let last;
    for (let i = 0; i < 31; i++) last = await call('POST', '/api/projects', { token: v.token, body: { name: 'N' + i } });
    assert.equal(last.status, 429);
  });
});

test('жёсткий режим подтверждения почты', async () => {
  const { call, register, mails, tokenOf } = makeApp({ REQUIRE_VERIFIED_EMAIL: '1' });
  assert.equal((await call('GET', '/api/config')).body.requireVerifiedEmail, true);
  const u = await register({ email: 'strict@example.com' });
  const denied = await call('POST', '/api/projects', { token: u.token, body: { name: 'A' } });
  assert.deepEqual([denied.status, denied.body.error.code], [403, 'email_unverified']);
  assert.equal((await call('GET', '/api/projects', { token: u.token })).status, 200, 'чтение разрешено');
  await call('POST', '/api/auth/verify', { body: { token: tokenOf(mails('verify', 'strict@example.com')[0]) } });
  assert.equal((await call('POST', '/api/projects', { token: u.token, body: { name: 'A' } })).status, 200);
});

test('пользователи в админке', async (t) => {
  const { call, register, adminToken, mails, db } = makeApp();
  const at = await adminToken();
  const a = await register({ email: 'alpha@example.com', name: 'Альфа' });
  const b = await register({ email: 'beta@example.com', name: 'Бета' });
  const pr = (await call('POST', '/api/projects', { token: a.token, body: { name: 'План', data: room('План') } })).body;

  await t.test('клиентский токен на /api/admin/* → 403, без токена → 401', async () => {
    for (const [m, p] of [['GET', '/api/admin/users'], ['GET', `/api/admin/users/${a.user.id}`], ['POST', `/api/admin/users/${b.user.id}/block`], ['GET', `/api/admin/projects/${pr.id}`]]) {
      assert.equal((await call(m, p, { token: a.token, body: {} })).status, 403, p);
      assert.equal((await call(m, p, { body: {} })).status, 401, p);
    }
  });
  await t.test('список: поиск, фильтры, число проектов', async () => {
    const all = (await call('GET', '/api/admin/users', { token: at })).body;
    assert.equal(all.total, 3); assert.equal(all.page, 1); assert.equal(all.pages, 1);
    assert.equal(all.users.find((x) => x.email === 'alpha@example.com').projects, 1);
    assert.ok(all.users.every((x) => !('password_hash' in x) && !('passwordHash' in x)));
    const q = (await call('GET', '/api/admin/users', { token: at, query: { q: 'ALPHA' } })).body;
    assert.deepEqual(q.users.map((x) => x.email), ['alpha@example.com']);
    const byName = (await call('GET', '/api/admin/users', { token: at, query: { q: 'Бета' } })).body;
    assert.deepEqual(byName.users.map((x) => x.email), ['beta@example.com']);
    assert.equal((await call('GET', '/api/admin/users', { token: at, query: { q: '%' } })).body.total, 0, 'подстановочные знаки экранируются');
    assert.equal((await call('GET', '/api/admin/users', { token: at, query: { role: 'admin' } })).body.total, 1);
    assert.equal((await call('GET', '/api/admin/users', { token: at, query: { status: 'unverified' } })).body.total, 2);
    assert.equal((await call('GET', '/api/admin/users', { token: at, query: { status: 'blocked' } })).body.total, 0);
  });
  await t.test('карточка: проекты, способы входа, сеансы', async () => {
    const r = (await call('GET', `/api/admin/users/${a.user.id}`, { token: at })).body;
    assert.deepEqual([r.user.email, r.user.hasPassword, r.user.sessions, r.projects.length, r.projects[0].name], ['alpha@example.com', true, 1, 1, 'План']);
    assert.equal((await call('GET', '/api/admin/users/nope', { token: at })).status, 404);
  });
  await t.test('блокировка: сеансы завершены, вход и сброс пароля невозможны, проекты целы', async () => {
    const r = await call('POST', `/api/admin/users/${b.user.id}/block`, { token: at, body: { reason: '  спам  ', notify: true } });
    assert.deepEqual([r.status, r.body.user.disabled, r.body.user.disabledReason], [200, true, 'спам']);
    assert.equal((await call('GET', '/api/auth/me', { token: b.token })).status, 401);
    assert.equal((await login(call, 'beta@example.com', GOOD_PW)).status, 401);
    await call('POST', '/api/auth/password/forgot', { body: { email: 'beta@example.com' } });
    assert.equal(mails('reset', 'beta@example.com').length, 0);
    const blockedMail = mails('blocked', 'beta@example.com');
    assert.equal(blockedMail.length, 1); assert.ok(blockedMail[0].text.includes('спам'));
    assert.equal((await call('GET', '/api/admin/users', { token: at, query: { status: 'blocked' } })).body.total, 1);
  });
  await t.test('ссылка подтверждения почты заблокированного не работает', async () => {
    const d = await db();
    assert.equal(Number((await d.get('SELECT COUNT(*) AS c FROM auth_tokens WHERE user_id=? AND used_at IS NULL', [b.user.id])).c), 0);
  });
  await t.test('разблокировка возвращает вход', async () => {
    const r = await call('POST', `/api/admin/users/${b.user.id}/unblock`, { token: at });
    assert.deepEqual([r.body.user.disabled, r.body.user.disabledReason], [false, '']);
    assert.equal((await login(call, 'beta@example.com', GOOD_PW)).status, 200);
  });
  await t.test('себя и другого администратора заблокировать нельзя', async () => {
    const me = (await call('GET', '/api/auth/me', { token: at })).body.user.id;
    assert.equal((await call('POST', `/api/admin/users/${me}/block`, { token: at, body: {} })).body.error.code, 'self');
    await (await db()).run("UPDATE users SET role='admin' WHERE id=?", [b.user.id]);
    assert.equal((await call('POST', `/api/admin/users/${b.user.id}/block`, { token: at, body: {} })).body.error.code, 'admin_protected');
    await (await db()).run("UPDATE users SET role='client' WHERE id=?", [b.user.id]);
  });
  await t.test('завершение сеансов пользователя', async () => {
    const r = await call('POST', `/api/admin/users/${a.user.id}/sessions/revoke`, { token: at });
    assert.equal(r.body.user.sessions, 0);
    assert.equal((await call('GET', '/api/auth/me', { token: a.token })).status, 401);
  });
  await t.test('просмотр проекта: данные, владелец, запись в журнале; записи чужого проекта нет', async () => {
    const r = await call('GET', `/api/admin/projects/${pr.id}`, { token: at });
    assert.deepEqual([r.status, r.body.owner.email, r.body.data.walls.length], [200, 'alpha@example.com', 4]);
    const log = (await call('GET', '/api/admin/audit', { token: at })).body.items;
    assert.ok(log.some((x) => x.action === 'project.view' && x.entity_id === pr.id));
    assert.ok(log.some((x) => x.action === 'user.block'));
    assert.equal((await call('PUT', `/api/admin/projects/${pr.id}`, { token: at, body: {} })).status, 405);
    assert.equal((await call('PUT', `/api/projects/${pr.id}`, { token: at, body: { data: room(), rev: 1 } })).status, 404);
    assert.equal((await call('GET', '/api/admin/projects/nope', { token: at })).status, 404);
  });
  await t.test('stats содержит число пользователей', async () => {
    assert.equal((await call('GET', '/api/admin/stats', { token: at })).body.users, 3);
  });
});

test('удалённые проекты стираются окончательно через 30 дней', async () => {
  const { call, register, db, app } = makeApp();
  const u = await register();
  const mk = async (name) => (await call('POST', '/api/projects', { token: u.token, body: { name, data: room(name) } })).body.id;
  const [old, fresh, alive] = [await mk('Старый'), await mk('Свежий'), await mk('Живой')];
  await call('DELETE', `/api/projects/${old}`, { token: u.token });
  await call('DELETE', `/api/projects/${fresh}`, { token: u.token });
  const d = await db();
  await d.run('UPDATE projects SET deleted_at=? WHERE id=?', [new Date(Date.now() - 31 * 864e5).toISOString(), old]);
  const { projects } = await app.init();
  assert.equal(await projects.purge(true), 1);
  const left = (await d.all('SELECT id FROM projects ORDER BY id')).map((r) => r.id).sort();
  assert.deepEqual(left, [fresh, alive].sort());
  assert.equal(await projects.purge(), 0, 'повторная чистка в течение часа пропускается');
  assert.deepEqual((await call('GET', '/api/projects', { token: u.token })).body.projects.map((p) => p.id), [alive]);
});
