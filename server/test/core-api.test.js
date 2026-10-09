'use strict';
/* Основа API: вход и сессии, лимиты попыток, проекты и корзина, каталог с кэшем, заявки, аккаунт.
   Эти проверки закрепляют исправления аудита: гонки лимитов, хеш сессий, нормализацию пароля, корзину, ETag каталога. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp } = require('./helpers.js');
const auth = require('../core/auth.js');

const ENV = { MAIL_QUIET: '1', SEED_DEMO: '0' };
const PW = 'correct horse battery';
const room = (extra = {}) => ({ vertices: [], walls: [], openings: [], furniture: [], ...extra });
/* запрос с произвольными заголовками (helpers.call передаёт только Authorization) */
const callH = (A, method, pathname, { token, headers = {}, query = {}, ip = '127.0.0.1' } = {}) => A.app.handle({ method, pathname, query, ip, ipResolved: true,
  header: (n) => (n.toLowerCase() === 'authorization' && token ? 'Bearer ' + token : headers[n.toLowerCase()]), body: async () => Buffer.alloc(0) });
const login = (A, email, password) => A.call('POST', '/api/auth/login', { email, password });

test('регистрация и вход: сессия в базе — только хеш; пароль не зависит от формы Юникода', async (t) => {
  const A = await makeApp(ENV); t.after(A.close);
  const composed = 'пайроль-длинный';      // «й» одним символом
  const decomposed = 'пайроль-длинный'; // «и» + кратка
  const reg = await A.call('POST', '/api/auth/register', { name: 'Анна', email: 'Anna@Test.dev', password: composed, acceptTerms: true, marketing: true });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  assert.match(reg.body.token, /^[a-f0-9]{64}$/);
  const rows = await A.ctx.db.all('SELECT token FROM sessions');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].token, auth.sessionKey(reg.body.token), 'в базе лежит хеш с пометкой h:');
  assert.ok(!JSON.stringify(rows).includes(reg.body.token), 'самого токена в базе нет');

  const me = await A.call('GET', '/api/auth/me', null, reg.body.token);
  const sent = JSON.parse(JSON.stringify(me.body)); // то, что реально уходит клиенту
  assert.deepEqual([me.status, sent.user.email, sent.user.sessionKey, sent.user.token], [200, 'anna@test.dev', undefined, undefined], 'ключ сессии наружу не уходит');

  assert.equal((await login(A, 'anna@test.dev', decomposed)).status, 200, 'тот же пароль, набранный составными символами');
  assert.equal((await login(A, 'anna@test.dev', composed)).status, 200);
  const bad = await login(A, 'anna@test.dev', 'не тот пароль');
  assert.deepEqual([bad.status, bad.body.error.code], [401, 'bad_credentials']);
  assert.deepEqual([(await login(A, 'nobody@test.dev', composed)).status], [401], 'неизвестная почта — тот же ответ');

  const acc = await A.call('GET', '/api/account', null, reg.body.token);
  assert.equal(acc.body.marketing, true);
  const off = await A.call('PATCH', '/api/account', { marketing: false }, reg.body.token);
  assert.deepEqual([off.status, off.body.marketing], [200, false], 'согласие на новости можно отозвать');
  assert.equal((await A.call('PATCH', '/api/account', {}, reg.body.token)).status, 422);

  const out = await A.call('POST', '/api/auth/logout', null, reg.body.token);
  assert.equal(out.status, 200);
  assert.equal((await A.call('GET', '/api/auth/me', null, reg.body.token)).status, 401, 'после выхода токен не действует');
});

test('сессии, созданные до хеширования, продолжают работать после миграции', async (t) => {
  const A = await makeApp(ENV); t.after(A.close);
  const u = await A.user('old@test.dev');
  const legacy = 'ab'.repeat(32);
  await A.ctx.db.run('INSERT INTO sessions (token,user_id,created_at,expires_at) VALUES (?,?,?,?)', [legacy, u.id, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
  const legacy2 = 'cd'.repeat(32);
  await A.ctx.db.run('INSERT INTO sessions (token,user_id,created_at,expires_at) VALUES (?,?,?,?)', [legacy2, u.id, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
  /* разовая миграция при запуске */
  assert.deepEqual(await auth.migrateSessions(A.ctx.db, 1), { done: 1, left: 1 }, 'порциями: что не успело — в следующий раз');
  assert.deepEqual(await auth.migrateSessions(A.ctx.db), { done: 1, left: 0 });
  assert.equal((await A.call('GET', '/api/auth/me', null, legacy)).status, 200);
  assert.deepEqual(await auth.migrateSessions(A.ctx.db), { done: 0, left: 0 }, 'повторный запуск ничего не трогает');
  /* сессия, которую старая версия кода записала уже после миграции (во время выкладки): переводится при первом обращении */
  const late = 'ef'.repeat(32);
  await A.ctx.db.run('INSERT INTO sessions (token,user_id,created_at,expires_at) VALUES (?,?,?,?)', [late, u.id, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
  assert.equal((await A.call('GET', '/api/auth/me', null, late)).status, 200);
  assert.equal((await A.ctx.db.get('SELECT token FROM sessions WHERE token=?', [auth.sessionKey(late)])).token, auth.sessionKey(late), 'после обращения в базе уже хеш');
  /* сам хеш из базы токеном не является */
  const stolen = auth.sessionKey(legacy2);
  assert.equal((await A.call('GET', '/api/auth/me', null, stolen)).status, 401);
  assert.equal((await A.call('GET', '/api/auth/me', null, stolen.slice(2))).status, 401, 'хеш без пометки — тоже не токен');
});

test('заблокированный аккаунт: о блокировке узнаёт только тот, кто знает пароль', async (t) => {
  const A = await makeApp(ENV); t.after(A.close);
  const u = await A.user('blocked@test.dev');
  await A.ctx.db.run('UPDATE users SET disabled=1 WHERE id=?', [u.id]);
  const ok = await login(A, 'blocked@test.dev', PW);
  assert.deepEqual([ok.status, ok.body.error.code], [403, 'blocked']);
  const bad = await login(A, 'blocked@test.dev', 'wrong password here');
  assert.deepEqual([bad.status, bad.body.error.code], [401, 'bad_credentials']);
});

test('лимит входа: параллельные попытки не проходят сверх лимита; верный пароль попыток не тратит', async (t) => {
  const A = await makeApp(ENV); t.after(A.close);
  await A.user('lim@test.dev');
  for (let i = 0; i < 15; i++) assert.equal((await login(A, 'lim@test.dev', PW)).status, 200, 'успешные входы в счёт не идут');
  const res = await Promise.all(Array.from({ length: 30 }, () => login(A, 'lim@test.dev', 'wrong password ' + Math.random())));
  const by = (s) => res.filter((r) => r.status === s).length;
  assert.deepEqual([by(401), by(429)], [10, 20], 'ровно десять проверок пароля, остальные отклонены лимитом');
  const after = await login(A, 'lim@test.dev', PW);
  assert.equal(after.status, 429, 'после десяти неудач вход закрыт на окно лимита даже с верным паролем');
  assert.ok(Number(after.headers['Retry-After']) > 0);
});

test('смена пароля: перебор текущего ограничен, остальные сеансы завершаются, текущий остаётся', async (t) => {
  const A = await makeApp(ENV); t.after(A.close);
  const u = await A.user('pw@test.dev');
  const second = (await login(A, 'pw@test.dev', PW)).body.token;
  const next = 'another long passphrase';
  for (let i = 0; i < 5; i++) assert.equal((await A.call('POST', '/api/auth/password', { current: 'wrong ' + i, next }, u.token)).status, 422);
  assert.equal((await A.call('POST', '/api/auth/password', { current: PW, next }, u.token)).status, 429, 'шестая попытка подряд — лимит');
  await A.ctx.db.run("DELETE FROM rate_limits WHERE key LIKE 'pw:%'");
  assert.equal((await A.call('POST', '/api/auth/password', { current: PW, next }, u.token)).status, 200);
  assert.equal((await A.call('GET', '/api/auth/me', null, u.token)).status, 200, 'текущий сеанс жив');
  assert.equal((await A.call('GET', '/api/auth/me', null, second)).status, 401, 'другой сеанс завершён');
  assert.equal((await login(A, 'pw@test.dev', next)).status, 200);
});

test('проекты: сохранение по версии, конфликт, корзина, восстановление, окончательное удаление', async (t) => {
  const A = await makeApp(ENV); t.after(A.close);
  const u = await A.user('p@test.dev'), other = await A.user('q@test.dev');
  const data = room({ vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 4000, y: 0 }], walls: [{ id: 'w', a: 'a', b: 'b' }],
    furniture: [{ id: 'f1', typeId: 'sofa', x: 1000, y: 500, rot: 90, dims: { W: 2200, D: 900, H: 850 } }, { id: 'f2', typeId: 'sofa', x: 'нет', y: 1, dims: {} }] });
  const c = await A.call('POST', '/api/projects', { name: 'Гостиная', data }, u.token);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.deepEqual(c.body.preview.furn, [[1000, 500, 2200, 900, 90]], 'в миниатюре — мебель с числовыми координатами');
  const id = c.body.id;

  const up = await A.call('PUT', '/api/projects/' + id, { name: 'Гостиная', data, rev: 1 }, u.token);
  assert.deepEqual([up.status, up.body.rev], [200, 2]);
  const stale = await A.call('PUT', '/api/projects/' + id, { name: 'Гостиная', data, rev: 1 }, u.token);
  assert.deepEqual([stale.status, stale.body.error.code, stale.body.error.details.rev], [409, 'conflict', 2]);
  for (const bad of [{ ...data, walls: ['строка'] }, { ...data, furniture: {} }, { ...data, vertices: [null] }]) {
    assert.equal((await A.call('PUT', '/api/projects/' + id, { data: bad, rev: 2 }, u.token)).status, 422, 'список с не‑объектами отклоняется');
  }
  assert.equal((await A.call('PUT', '/api/projects/' + id, { data, rev: 2 }, other.token)).status, 404, 'чужой проект не виден');

  const share = await A.call('POST', '/api/projects/' + id + '/share', null, u.token);
  assert.equal((await A.call('GET', '/api/shared/' + share.body.token)).status, 200);
  const del = await A.call('DELETE', '/api/projects/' + id, null, u.token);
  assert.deepEqual([del.status, del.body.restorableDays], [200, 30]);
  assert.equal((await A.call('GET', '/api/shared/' + share.body.token)).status, 404, 'ссылка на удалённый проект не работает');
  assert.equal((await A.call('GET', '/api/projects/' + id, null, u.token)).status, 404);
  const list = (await A.call('GET', '/api/projects', null, u.token)).body;
  assert.deepEqual([list.projects.length, list.trash], [0, 1]);
  const trash = (await A.call('GET', '/api/projects/trash', null, u.token)).body;
  assert.deepEqual([trash.projects.map((p) => p.id), trash.days], [[id], 30]);
  assert.ok(trash.projects[0].deletedAt && trash.projects[0].purgeAt > trash.projects[0].deletedAt);
  assert.equal((await A.call('GET', '/api/projects/trash', null, other.token)).body.projects.length, 0, 'чужая корзина пуста');
  assert.equal((await A.call('POST', '/api/projects/' + id + '/restore', null, other.token)).status, 404);

  const back = await A.call('POST', '/api/projects/' + id + '/restore', null, u.token);
  assert.deepEqual([back.status, back.body.id, back.body.shared], [200, id, false], 'восстановлен без прежней ссылки');
  assert.equal((await A.call('GET', '/api/projects/' + id, null, u.token)).body.data.furniture.length, 2, 'данные целы');
  assert.equal((await A.call('POST', '/api/projects/' + id + '/restore', null, u.token)).status, 404, 'восстанавливать нечего');

  await A.call('DELETE', '/api/projects/' + id, null, u.token);
  assert.equal((await A.call('DELETE', '/api/projects/trash/' + id, null, u.token)).status, 200);
  assert.equal(Number((await A.ctx.db.get('SELECT COUNT(*) AS c FROM projects WHERE id=?', [id])).c), 0, 'стёрт окончательно');
});

test('проекты: предел 50 держится и при одновременном создании; корзина не растёт без конца', async (t) => {
  const A = await makeApp(ENV); t.after(A.close);
  const u = await A.user('many@test.dev');
  await A.ctx.db.run("DELETE FROM rate_limits"); // лимит частоты создания здесь не проверяется
  const mk = (i) => A.ctx.projects.create({ id: u.id }, { name: 'П' + i, data: room() });
  for (let i = 0; i < 48; i++) await mk(i);
  const res = await Promise.allSettled([mk('a'), mk('b'), mk('c'), mk('d'), mk('e')]);
  const passed = res.filter((r) => r.status === 'fulfilled').length;
  assert.ok(passed <= 2, 'из пяти одновременных проходит не больше двух: ' + passed);
  assert.equal(await A.ctx.projects.count({ id: u.id }), 48 + passed, 'лишние строки убраны');
  for (let i = await A.ctx.projects.count({ id: u.id }); i < 50; i++) await mk('x' + i); // по одному — до предела
  assert.equal(await A.ctx.projects.count({ id: u.id }), 50);
  assert.equal((await A.call('POST', '/api/projects', { name: 'лишний', data: room() }, u.token)).status, 422);
  assert.equal(await A.ctx.projects.count({ id: u.id }), 50, 'отказ не оставляет лишней строки');

  const all = (await A.call('GET', '/api/projects', null, u.token)).body.projects;
  for (const p of all.slice(0, 35)) await A.ctx.projects.remove({ id: u.id }, p.id);
  const trash = (await A.call('GET', '/api/projects/trash', null, u.token)).body.projects;
  assert.equal(trash.length, 30, 'в корзине не больше 30 проектов — самые старые стёрты');
});

test('каталог: порции, фильтр «с фото», ETag и ответ 304 без тела; ссылка товара — только http(s)', async (t) => {
  const A = await makeApp(ENV); t.after(A.close);
  await A.setCatalog([
    { id: 'p-1', typeId: 'sofa', formId: 'straight', dims: { W: 2200, D: 900, H: 850 }, price: 10 },
    { id: 'p-2', typeId: 'sofa', formId: 'straight', dims: { W: 2000, D: 900, H: 850 }, price: 20 },
    { id: 'p-3', typeId: 'sofa', formId: 'straight', dims: { W: 1800, D: 900, H: 850 }, price: 30, status: 'draft' },
  ]);
  await A.ctx.db.run("INSERT INTO product_images (id,product_id,file,mime,sort,created_at) VALUES ('i1','p-2','https://img.example/p2.jpg','image/jpeg',0,?)", [new Date().toISOString()]);
  await A.ctx.db.run("UPDATE products SET url='javascript:alert(1)' WHERE id='p-1'");

  const all = await callH(A, 'GET', '/api/catalog/products');
  assert.equal(all.status, 200);
  assert.deepEqual([all.body.products.map((p) => p.id), all.body.total, all.body.next], [['p-1', 'p-2'], 2, null], 'черновик не публикуется');
  assert.equal(all.body.products[0].url, '', 'ссылка не http(s) наружу не отдаётся');
  assert.match(all.headers['Cache-Control'], /s-maxage=60/);
  const etag = all.headers.ETag; assert.match(etag, /^W\/"/);

  const same = await callH(A, 'GET', '/api/catalog/products', { headers: { 'if-none-match': etag } });
  assert.deepEqual([same.status, same.body, same.headers.ETag], [304, null, etag]);
  const page = await callH(A, 'GET', '/api/catalog/products', { query: { limit: '1' } });
  assert.deepEqual([page.body.products.length, page.body.next], [1, 1]);
  assert.notEqual(page.headers.ETag, etag, 'у каждой порции своя отметка');
  const withImg = await callH(A, 'GET', '/api/catalog/products', { query: { limit: '8', images: '1' } });
  assert.deepEqual([withImg.body.products.map((p) => p.id), withImg.body.total], [['p-2'], 1]);
  assert.equal((await callH(A, 'GET', '/api/catalog/products', { query: { images: '0' } })).body.total, 2, 'images=0 — без фильтра');
  assert.equal((await callH(A, 'GET', '/api/catalog/products', { headers: { 'if-none-match': etag.replace(/^W\//, '') + ', "другое"' } })).status, 304, 'сравнение отметок — слабое');

  await A.ctx.db.run("UPDATE products SET price=11, updated_at=? WHERE id='p-1'", [new Date(Date.now() + 1000).toISOString()]);
  const changed = await callH(A, 'GET', '/api/catalog/products', { headers: { 'if-none-match': etag } });
  assert.equal(changed.status, 200, 'после изменения товара отметка другая');

  const adm = await A.user('adm@test.dev', { role: 'admin' });
  const base = { typeId: 'sofa', formId: 'straight', name: 'Диван', price: 100, currency: 'BYN', dims: { W: 2000, D: 900, H: 800 } };
  const bad = await A.call('POST', '/api/admin/products', { ...base, url: 'javascript:alert(1)' }, adm.token);
  assert.deepEqual([bad.status, !!bad.body.error.details.url], [422, true]);
  assert.equal((await A.call('POST', '/api/admin/products', { ...base, url: 'https://shop.example/divan' }, adm.token)).status, 200);
});

test('некорректный адрес запроса — 400, а не 500', async (t) => {
  const A = await makeApp(ENV); t.after(A.close);
  const u = await A.user('bad@test.dev');
  const r = await A.call('GET', '/api/projects/%E0%A4%A', null, u.token);
  assert.deepEqual([r.status, r.body.error.code], [400, 'bad_path']);
});

test('заявки: лимит считает только принятые; свои заявки у пользователя; поиск, страницы и заметка у менеджера', async (t) => {
  const A = await makeApp(ENV); t.after(A.close);
  await A.setCatalog([{ id: 'sofa-1', typeId: 'sofa', formId: 'straight', name: 'Диван Осло', dims: { W: 2200, D: 900, H: 850 }, price: 900 }]);
  const u = await A.user('lead@test.dev'), other = await A.user('lead2@test.dev'), adm = await A.user('boss@test.dev', { role: 'admin' });
  const pr = (await A.call('POST', '/api/projects', { name: 'Гостиная Ёлка', data: room() }, u.token)).body;
  const send = (body) => A.call('POST', `/api/projects/${pr.id}/lead`, body, u.token);
  const good = { name: 'Пётр', phone: '+375 29 123-45-67', items: [{ productId: 'sofa-1', qty: 2 }] };
  for (let i = 0; i < 4; i++) assert.equal((await send({ ...good, phone: '12' })).status, 422, 'ошибка в телефоне попытку не тратит');
  const res = await Promise.all(Array.from({ length: 8 }, () => send(good)));
  assert.deepEqual([res.filter((r) => r.status === 200).length, res.filter((r) => r.status === 429).length], [5, 3], 'ровно пять принятых заявок в час');

  const mine = (await A.call('GET', '/api/leads', null, u.token)).body.leads;
  assert.equal(mine.length, 5);
  assert.deepEqual([mine[0].projectName, mine[0].status, mine[0].total, mine[0].note, mine[0].phone], ['Гостиная Ёлка', 'new', 1800, undefined, undefined], 'заметка менеджера и контакты в ответ не входят');
  assert.equal((await A.call('GET', '/api/leads', null, other.token)).body.leads.length, 0);
  assert.equal((await A.call('GET', '/api/leads')).status, 401);

  const list = (await A.call('GET', '/api/admin/leads', null, adm.token, { limit: '2' })).body;
  assert.deepEqual([list.leads.length, list.total, list.pages, list.page, list.fresh], [2, 5, 3, 1, 5]);
  assert.equal((await A.call('GET', '/api/admin/leads', null, adm.token, { limit: '2', page: '3' })).body.leads.length, 1);
  for (const [q, n] of [['ПЁТР', 5], ['петр', 5], ['375291234567', 5], ['елка', 5], ['LEAD@test', 5], ['никто', 0]]) {
    assert.equal((await A.call('GET', '/api/admin/leads', null, adm.token, { q })).body.total, n, 'поиск: ' + q);
  }
  const note = await A.call('POST', `/api/admin/leads/${mine[0].id}/note`, { note: '  Перезвонить в среду  ' }, adm.token);
  assert.deepEqual([note.status, note.body.note], [200, 'Перезвонить в среду']);
  assert.equal((await A.call('POST', `/api/admin/leads/${mine[0].id}/note`, { note: 'x' }, u.token)).status, 403);
  await A.call('POST', `/api/admin/leads/${mine[0].id}/status`, { status: 'done' }, adm.token);
  assert.equal((await A.call('GET', '/api/admin/leads', null, adm.token, { status: 'new' })).body.total, 4);
  assert.equal((await A.call('GET', '/api/leads', null, u.token)).body.leads.find((l) => l.id === mine[0].id).status, 'done');

  /* письмо‑подтверждение пользователю и письмо менеджеру пишутся в папку outbox (почтовый ключ в тесте не задан) */
  const fs = require('node:fs'), path = require('node:path');
  const kinds = fs.readdirSync(path.join(A.ctx.dataDir, 'outbox')).map((f) => JSON.parse(fs.readFileSync(path.join(A.ctx.dataDir, 'outbox', f), 'utf8'))).filter((m) => m.kind === 'lead_received');
  assert.equal(kinds.length, 5);
  assert.deepEqual([kinds[0].to, /Диван Осло ×2/.test(kinds[0].text)], ['lead@test.dev', true]);

  /* на неподтверждённый адрес подтверждение не уходит: иначе на чужую почту можно слать письма сайта */
  const stranger = await A.user('someone-else@test.dev', { verified: false });
  const pr2 = (await A.call('POST', '/api/projects', { name: 'Зайдите на evil.example', data: room() }, stranger.token)).body;
  assert.equal((await A.call('POST', `/api/projects/${pr2.id}/lead`, good, stranger.token)).status, 200);
  const all = fs.readdirSync(path.join(A.ctx.dataDir, 'outbox')).map((f) => JSON.parse(fs.readFileSync(path.join(A.ctx.dataDir, 'outbox', f), 'utf8')));
  assert.equal(all.filter((m) => m.to === 'someone-else@test.dev').length, 0);
});

test('повторное письмо подтверждения не ломает ссылку из первого; ссылка сброса пароля действует только последняя', async (t) => {
  const A = await makeApp(ENV); t.after(A.close);
  const u = await A.user('v@test.dev', { verified: false });
  const first = await A.ctx.tokens.create(u.id, 'verify'), second = await A.ctx.tokens.create(u.id, 'verify');
  assert.equal((await A.ctx.tokens.find(first, 'verify')).state, 'ok');
  assert.equal((await A.call('POST', '/api/auth/verify', { token: first })).status, 200);
  assert.equal((await A.ctx.tokens.find(second, 'verify')).state, 'ok');
  const r1 = await A.ctx.tokens.create(u.id, 'reset'), r2 = await A.ctx.tokens.create(u.id, 'reset');
  assert.deepEqual([(await A.ctx.tokens.find(r1, 'reset')).state, (await A.ctx.tokens.find(r2, 'reset')).state], ['invalid', 'ok']);
});

test('вход через Яндекс: адрес не на домене Яндекса не открывает существующий аккаунт', async (t) => {
  const A = await makeApp(ENV); t.after(A.close);
  await A.user('victim@gmail.com');
  await assert.rejects(() => A.ctx.oauth.resolve('yandex', { subject: 'y-1', email: 'victim@gmail.com', emailTrusted: false, name: 'Х' }), (e) => e.code === 'use_password');
  assert.equal(Number((await A.ctx.db.get('SELECT COUNT(*) AS c FROM user_identities')).c), 0, 'связь с чужим аккаунтом не создана');
  const own = await A.ctx.oauth.resolve('yandex', { subject: 'y-2', email: 'new@corp.example', emailTrusted: false, name: 'Новый' });
  assert.deepEqual([own.created, own.user.email_verified_at], [true, null], 'новый аккаунт создаётся, но почта не считается подтверждённой');
  const trusted = await A.ctx.oauth.resolve('yandex', { subject: 'y-3', email: 'victim2@yandex.ru', emailTrusted: true, name: 'Я' });
  assert.ok(trusted.user.email_verified_at);

  /* аккаунт на чужой адрес создан заранее через провайдера с неподтверждённой почтой; настоящий владелец приходит позже */
  const pre = await A.ctx.oauth.resolve('yandex', { subject: 'y-att', email: 'owner@gmail.com', emailTrusted: false, name: 'Чужой' });
  const viaGoogle = await A.ctx.oauth.resolve('google', { subject: 'g-owner', email: 'owner@gmail.com', emailTrusted: true, name: 'Владелец' });
  assert.equal(viaGoogle.user.id, pre.user.id, 'владелец получает аккаунт со своей почтой');
  assert.deepEqual((await A.ctx.db.all('SELECT provider, subject FROM user_identities WHERE user_id=?', [pre.user.id])).map((r) => r.provider + ':' + r.subject), ['google:g-owner'], 'чужой способ входа снят');
  await assert.rejects(() => A.ctx.oauth.resolve('yandex', { subject: 'y-att', email: 'owner@gmail.com', emailTrusted: false, name: 'Чужой' }), (e) => e.code === 'use_password', 'прежним входом в аккаунт больше не попасть');

  /* то же через сброс пароля: письмо получает владелец ящика */
  const pre2 = await A.ctx.oauth.resolve('yandex', { subject: 'y-att2', email: 'owner2@mail.example', emailTrusted: false, name: 'Чужой' });
  const reset = await A.ctx.tokens.create(pre2.user.id, 'reset');
  assert.equal((await A.call('POST', '/api/auth/password/reset', { token: reset, password: 'new long passphrase 1' })).status, 200);
  assert.equal(Number((await A.ctx.db.get('SELECT COUNT(*) AS c FROM user_identities WHERE user_id=?', [pre2.user.id])).c), 0);
});

test('удаление аккаунта: журнал не хранит сведений об удалённом, поиск пользователей не зависит от регистра', async (t) => {
  const A = await makeApp(ENV); t.after(A.close);
  const reg = await A.call('POST', '/api/auth/register', { name: 'Фёдор Ёжиков', email: 'fedor@test.dev', password: PW, acceptTerms: true });
  const adm = await A.user('root@test.dev', { role: 'admin' });
  for (const q of ['фёдор', 'ФЕДОР', 'ежиков', 'FEDOR@']) assert.equal((await A.call('GET', '/api/admin/users', null, adm.token, { q })).body.total, 1, 'поиск: ' + q);
  const audit = await A.ctx.db.all("SELECT data FROM audit_log WHERE action='user.register'");
  assert.deepEqual(audit.map((r) => r.data), ['{}'], 'метка адреса в журнал регистрации не пишется');
  const del = await A.call('POST', '/api/account/delete', { password: PW }, reg.body.token);
  assert.equal(del.status, 200);
  assert.equal((await A.call('GET', '/api/admin/users', null, adm.token, { q: 'федор' })).body.total, 0);
});

test('ИИ‑дизайнер: остаток генераций, возврат неудачной и месячный предел', async (t) => {
  const A = await makeApp({ ...ENV, AI_MOCK: '1', AI_DAILY_RUNS: '3' }); t.after(A.close);
  await A.setCatalog([{ id: 's-a', typeId: 'sofa', formId: 'straight', dims: { W: 2200, D: 900, H: 850 }, price: 900 }, { id: 's-b', typeId: 'sofa', formId: 'straight', dims: { W: 2200, D: 900, H: 850 }, price: 1500 }]);
  const u = await A.user('ai@test.dev');
  const CONCEPT = { room: { wallHeight: 2700, longestWall: 5000, maxSpan: 5000, area: 20, w: 5000, h: 4000, doors: 1, windows: 1 },
    slots: [{ id: 'f1', typeId: 'sofa', formId: 'straight', formAny: false, productId: null, policy: 'free', dims: { W: 2200, D: 900, H: 850 }, constraints: {}, maxFit: null }], context: [],
    finishes: { walls: 'ai', floor: 'ai', ceiling: 'keep' }, text: 'Светлая гостиная в скандинавском стиле', prefs: { style: 'Скандинавский' } };
  assert.deepEqual((await A.call('GET', '/api/ai/quota', null, u.token)).body, { runs: 3, left: 3, retryAfter: 0 });
  const c = await A.call('POST', '/api/ai/concept', CONCEPT, u.token);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal((await A.call('GET', '/api/ai/quota', null, u.token)).body.left, 2);
  const back = await A.call('POST', '/api/ai/refund', { pass: c.body.pass }, u.token);
  assert.deepEqual([back.status, back.body.refunded], [200, true]);
  assert.equal((await A.call('GET', '/api/ai/quota', null, u.token)).body.left, 3, 'запуск возвращён');
  assert.equal((await A.call('POST', '/api/ai/refund', { pass: c.body.pass }, u.token)).body.refunded, false, 'за одну генерацию — один возврат');
  const designer = require('../core/designer.js');
  const spent = await A.ctx.limiter.peek(`ai:pass:${c.body.runId}`, designer.LIM.layoutCallsPerPass, designer.LIM.passTtlSec);
  assert.equal(spent.ok, false, 'возвращённой генерацией пользоваться нельзя: её пропуск исчерпан');
  assert.equal((await A.call('POST', '/api/ai/refund', { pass: 'подделка' }, u.token)).status, 403);

  const B = await makeApp({ ...ENV, AI_MOCK: '1', AI_MONTHLY_CALLS: '1' }); t.after(B.close);
  await B.setCatalog([{ id: 's-a', typeId: 'sofa', formId: 'straight', dims: { W: 2200, D: 900, H: 850 }, price: 900 }]);
  const v = await B.user('ai2@test.dev');
  assert.equal((await B.call('POST', '/api/ai/concept', CONCEPT, v.token)).status, 200);
  const over = await B.call('POST', '/api/ai/concept', CONCEPT, v.token);
  assert.deepEqual([over.status, over.body.error.code], [429, 'ai_limit'], 'месячный предел платформы');
  assert.equal((await B.call('GET', '/api/ai/quota', null, v.token)).body.left, 9, 'отказ по общему пределу не тратит личный запуск');
});
