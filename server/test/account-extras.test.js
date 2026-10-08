'use strict';
/* Фото в аккаунте, ссылка на проект для просмотра, заявка менеджеру. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeApp } = require('./helpers.js');
const { photoIdsOf, publicData } = require('../core/projects.js');

/* наименьшие «картинки»: сервер смотрит только на подпись формата */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 2)]);
const room = (extra = {}) => ({ vertices: [], walls: [], openings: [], furniture: [], ...extra });
/* запрос с двоичным телом: helpers.call превращает тело в JSON, поэтому здесь свой вызов */
const raw = (A, method, pathname, buf, token, query = {}) => A.app.handle({ method, pathname, query, ip: '127.0.0.1', ipResolved: true,
  header: (n) => (n.toLowerCase() === 'authorization' && token ? 'Bearer ' + token : undefined),
  body: async (limit) => { if (buf.length > limit) { const { ApiError } = require('../core/app.js'); throw new ApiError(413, 'too_large', 'Слишком большой запрос'); } return buf; } });

test('фото проекта: какие идентификаторы считаются использованными', () => {
  const data = room({ walls: [{ id: 'w1', material: { type: 'photo', photoId: 'wallphoto1' } }, { id: 'w2', material: { type: 'color', color: '#fff' } }],
    floor: { material: { type: 'photo', photoId: 'floorphoto' } }, brief: { photos: [{ photoId: 'refphoto01' }], text: 'личное' }, briefDraft: { photos: [{ photoId: 'draftphoto' }] },
    ai: { brief: { photos: [{ photoId: 'refphoto02' }], text: 'ещё' }, taste: { profile: {} }, base: { finishes: { walls: { w1: { type: 'photo', photoId: 'basephoto1' } } } }, variants: [{ finishes: { walls: {}, floor: { type: 'photo', photoId: 'varphoto01' } } }] } });
  assert.deepEqual([...photoIdsOf(data)].sort(), ['basephoto1', 'draftphoto', 'floorphoto', 'refphoto01', 'refphoto02', 'varphoto01', 'wallphoto1']);
  assert.deepEqual([...photoIdsOf(data, { materialsOnly: true })].sort(), ['basephoto1', 'floorphoto', 'varphoto01', 'wallphoto1']);
  const pub = publicData(data);
  assert.deepEqual([pub.brief.text, pub.brief.photos, pub.ai.brief.text, pub.ai.taste, pub.briefDraft], ['', [], '', null, undefined], 'личное убрано');
  assert.deepEqual(pub.photos.sort(), ['basephoto1', 'floorphoto', 'varphoto01', 'wallphoto1']);
  assert.equal(data.brief.text, 'личное', 'исходные данные не тронуты');
});

test('фото в аккаунте: загрузка, чтение с другого «устройства», проверка формата и прав', async (t) => {
  const A = await makeApp({}); t.after(A.close);
  const u = await A.user('a@test.dev'), other = await A.user('b@test.dev');
  assert.equal((await raw(A, 'PUT', '/api/photos/photo001', JPEG, null)).status, 401);
  const put = await raw(A, 'PUT', '/api/photos/photo001', JPEG, u.token, { w: '800', h: '600' });
  assert.deepEqual([put.status, put.body.ok, put.body.existed], [200, true, undefined]);
  assert.equal((await raw(A, 'PUT', '/api/photos/photo001', PNG, u.token)).body.existed, true, 'повторная загрузка ничего не меняет');
  const got = (await A.call('GET', '/api/photos/photo001', null, u.token)).body;
  assert.deepEqual([got.mime, got.w, got.h, Buffer.from(got.data, 'base64').equals(JPEG)], ['image/jpeg', 800, 600, true]);
  assert.deepEqual((await A.call('GET', '/api/photos', null, u.token)).body.photos.map(p => p.id), ['photo001']);
  assert.equal((await A.call('GET', '/api/photos/photo001', null, other.token)).status, 404, 'чужое фото не видно');
  assert.equal((await raw(A, 'PUT', '/api/photos/photo002', Buffer.from('это не картинка, а текст'), u.token)).status, 415);
  assert.equal((await raw(A, 'PUT', '/api/photos/photo003', Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)]), u.token)).status, 413);
  assert.equal((await raw(A, 'PUT', '/api/photos/' + encodeURIComponent('../../etc'), JPEG, u.token)).status, 422);
  /* адрес файла наружу не отдаётся */
  assert.equal(JSON.stringify(got).includes('/files/'), false);
});

test('удаление фото: остаётся, пока на него ссылается другой проект; файлы уходят вместе с аккаунтом', async (t) => {
  const A = await makeApp({}); t.after(A.close);
  const u = await A.user('a@test.dev');
  await raw(A, 'PUT', '/api/photos/shared01', JPEG, u.token); await raw(A, 'PUT', '/api/photos/lonely01', PNG, u.token);
  const mat = (id) => room({ walls: [{ id: 'w1', material: { type: 'photo', photoId: id } }], photos: [id] });
  const p1 = (await A.call('POST', '/api/projects', { name: 'Первый', data: mat('shared01') }, u.token)).body;
  const p2 = (await A.call('POST', '/api/projects/' + p1.id + '/copy', null, u.token)).body;
  assert.ok(p2.id && p2.id !== p1.id);
  const kept = (await A.call('DELETE', '/api/photos/shared01', null, u.token, { project: p1.id })).body;
  assert.deepEqual([kept.removed, kept.kept], [false, true], 'копия проекта всё ещё использует фото');
  assert.equal((await A.call('DELETE', '/api/photos/lonely01', null, u.token)).body.removed, true);
  assert.equal((await A.call('GET', '/api/photos/lonely01', null, u.token)).status, 404);
  await A.call('DELETE', '/api/projects/' + p2.id, null, u.token);
  assert.equal((await A.call('DELETE', '/api/photos/shared01', null, u.token, { project: p1.id })).body.removed, true, 'копия удалена — фото можно убрать');
  /* удаление аккаунта убирает папку пользователя из хранилища */
  await raw(A, 'PUT', '/api/photos/last0001', JPEG, u.token);
  const dir = path.join(A.ctx.dataDir, 'uploads', 'users', u.id);
  assert.equal(fs.existsSync(dir), true);
  assert.equal((await A.call('POST', '/api/account/delete', { password: 'correct horse battery' }, u.token)).status, 200);
  assert.equal(fs.existsSync(dir), false);
});

test('ссылка на проект: включение, просмотр без входа, личное скрыто, отключение', async (t) => {
  const A = await makeApp({ PUBLIC_URL: 'https://plan.example' }); t.after(A.close);
  const u = await A.user('a@test.dev'), other = await A.user('b@test.dev');
  await raw(A, 'PUT', '/api/photos/wallphoto1', JPEG, u.token); await raw(A, 'PUT', '/api/photos/refphoto01', PNG, u.token);
  const data = room({ walls: [{ id: 'w1', a: 'v1', b: 'v2', material: { type: 'photo', photoId: 'wallphoto1' } }], brief: { text: 'хочу светлую гостиную', photos: [{ photoId: 'refphoto01' }] }, photos: ['wallphoto1', 'refphoto01'] });
  const p = (await A.call('POST', '/api/projects', { name: 'Гостиная', data }, u.token)).body;
  assert.equal(p.shared, false);
  assert.equal((await A.call('POST', '/api/projects/' + p.id + '/share', null, other.token)).status, 404, 'чужой проект открыть нельзя');
  const s = (await A.call('POST', '/api/projects/' + p.id + '/share', null, u.token)).body;
  assert.match(s.token, /^[A-Za-z0-9_-]{24,64}$/);
  assert.equal(s.url, 'https://plan.example/editor?share=' + s.token);
  assert.equal((await A.call('POST', '/api/projects/' + p.id + '/share', null, u.token)).body.token, s.token, 'ссылка одна на проект');
  assert.equal((await A.call('GET', '/api/projects/' + p.id, null, u.token)).body.share, s.token);
  assert.equal((await A.call('GET', '/api/projects', null, u.token)).body.projects[0].shared, true);
  const pub = await A.call('GET', '/api/shared/' + s.token, null, null);
  assert.equal(pub.status, 200);
  assert.deepEqual([pub.body.name, pub.body.data.brief.text, pub.body.data.brief.photos, pub.body.data.photos], ['Гостиная', '', [], ['wallphoto1']]);
  assert.equal(JSON.stringify(pub.body).includes('a@test.dev'), false, 'почта владельца по ссылке не видна');
  assert.equal((await A.call('GET', `/api/shared/${s.token}/photos/wallphoto1`, null, null)).status, 200, 'текстура комнаты доступна');
  assert.equal((await A.call('GET', `/api/shared/${s.token}/photos/refphoto01`, null, null)).status, 404, 'фото‑референс — нет');
  assert.equal((await A.call('GET', '/api/shared/' + 'x'.repeat(32), null, null)).status, 404);
  assert.equal((await A.call('GET', '/api/shared/short', null, null)).status, 404);
  /* сохранение проекта ссылку не сбрасывает; отключение и удаление — сбрасывают */
  const up = (await A.call('PUT', '/api/projects/' + p.id, { name: 'Гостиная', data, rev: 1 }, u.token)).body;
  assert.equal(up.shared, true);
  await A.call('DELETE', '/api/projects/' + p.id + '/share', null, u.token);
  assert.equal((await A.call('GET', '/api/shared/' + s.token, null, null)).status, 404);
  const s2 = (await A.call('POST', '/api/projects/' + p.id + '/share', null, u.token)).body;
  assert.notEqual(s2.token, s.token, 'после отключения адрес новый');
  await A.call('DELETE', '/api/projects/' + p.id, null, u.token);
  assert.equal((await A.call('GET', '/api/shared/' + s2.token, null, null)).status, 404);
});

test('поддержка видит фото просматриваемого проекта', async (t) => {
  const A = await makeApp({}); t.after(A.close);
  const u = await A.user('a@test.dev'), adm = await A.user('root@test.dev', { role: 'admin' });
  await raw(A, 'PUT', '/api/photos/refphoto01', PNG, u.token);
  const p = (await A.call('POST', '/api/projects', { name: 'П', data: room({ brief: { photos: [{ photoId: 'refphoto01' }] } }) }, u.token)).body;
  assert.equal((await A.call('GET', `/api/admin/projects/${p.id}/photos/refphoto01`, null, adm.token)).body.mime, 'image/png');
  assert.equal((await A.call('GET', `/api/admin/projects/${p.id}/photos/nothere01`, null, adm.token)).status, 404);
  assert.equal((await A.call('GET', `/api/admin/projects/${p.id}/photos/refphoto01`, null, u.token)).status, 403);
});

test('заявка менеджеру: цены из каталога, проверка контактов, письмо, раздел администратора', async (t) => {
  const A = await makeApp({ CONTACT_EMAIL: 'sales@shop.example', MAIL_QUIET: '1' }); t.after(A.close);
  await A.setCatalog([{ id: 'sofa-1', typeId: 'sofa', formId: 'straight', name: 'Диван Осло', price: 1500, currency: 'BYN', dims: { W: 2000, D: 900, H: 800 } },
    { id: 'chair-1', typeId: 'armchair', formId: 'rect', name: 'Кресло', price: 400.5, currency: 'BYN', dims: { W: 800, D: 800, H: 900 } },
    { id: 'draft-1', typeId: 'armchair', formId: 'rect', name: 'Черновик', price: 1, currency: 'BYN', dims: { W: 800, D: 800, H: 900 }, status: 'draft' }]);
  const u = await A.user('buyer@test.dev'), other = await A.user('b@test.dev'), adm = await A.user('root@test.dev', { role: 'admin' });
  const p = (await A.call('POST', '/api/projects', { name: 'Гостиная', data: room() }, u.token)).body;
  const body = { name: 'Анна', phone: '+375 29 123-45-67', comment: 'Позвоните\nпосле 18', variant: 'Вариант 1', items: [{ productId: 'sofa-1', qty: 1, price: 1 }, { productId: 'chair-1', qty: 2 }, { productId: 'draft-1', qty: 1 }, { productId: 'gone-1', qty: 1 }] };
  assert.equal((await A.call('POST', `/api/projects/${p.id}/lead`, body, other.token)).status, 404, 'заявка — только по своему проекту');
  for (const [patch, field] of [[{ name: '' }, 'name'], [{ phone: '12' }, 'phone'], [{ phone: 'позвоните мне' }, 'phone']]) {
    const r = await A.call('POST', `/api/projects/${p.id}/lead`, { ...body, ...patch }, u.token);
    assert.deepEqual([r.status, Object.keys(r.body.error.details.fields)], [422, [field]]);
  }
  assert.equal((await A.call('POST', `/api/projects/${p.id}/lead`, { ...body, items: [] }, u.token)).status, 422);
  assert.equal((await A.call('POST', `/api/projects/${p.id}/lead`, { ...body, items: [{ productId: 'gone-1', qty: 1 }] }, u.token)).status, 422, 'ни одного товара из каталога');
  const r = await A.call('POST', `/api/projects/${p.id}/lead`, body, u.token);
  assert.deepEqual([r.status, r.body.items, r.body.total, r.body.currency], [200, 2, 2301, 'BYN'], 'сумма посчитана сервером; черновик и исчезнувший товар отброшены');
  /* письмо менеджеру (локально письма пишутся в папку outbox) */
  const out = path.join(A.ctx.dataDir, 'outbox');
  const mail = fs.readdirSync(out).map(f => JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'))).find(m => m.kind === 'lead');
  assert.equal(mail.to, 'sales@shop.example');
  assert.match(mail.subject, /Анна/); assert.match(mail.text, /Диван Осло — 1\s500 BYN/); assert.match(mail.text, /Кресло ×2 — 801 BYN/); assert.match(mail.text, /Контакт: Анна, \+375 29 123-45-67, buyer@test\.dev/); assert.match(mail.text, /Позвоните после 18/);
  /* администратор */
  assert.equal((await A.call('GET', '/api/admin/leads', null, u.token)).status, 403);
  const list = (await A.call('GET', '/api/admin/leads', null, adm.token)).body;
  assert.deepEqual([list.fresh, list.leads.length, list.leads[0].name, list.leads[0].phone, list.leads[0].email, list.leads[0].projectName, list.leads[0].variant], [1, 1, 'Анна', '+375 29 123-45-67', 'buyer@test.dev', 'Гостиная', 'Вариант 1']);
  assert.deepEqual(list.leads[0].items.map(i => [i.productId, i.qty, i.price]), [['sofa-1', 1, 1500], ['chair-1', 2, 400.5]]);
  assert.equal((await A.call('GET', '/api/admin/stats', null, adm.token)).body.leads, 1);
  const done = await A.call('POST', `/api/admin/leads/${list.leads[0].id}/status`, { status: 'done' }, adm.token);
  assert.equal(done.body.status, 'done');
  assert.equal((await A.call('GET', '/api/admin/leads', null, adm.token, { status: 'new' })).body.leads.length, 0);
  assert.equal((await A.call('POST', `/api/admin/leads/${list.leads[0].id}/status`, { status: 'weird' }, adm.token)).status, 422);
  /* не больше пяти заявок в час */
  const codes = []; for (let i = 0; i < 6; i++) codes.push((await A.call('POST', `/api/projects/${p.id}/lead`, body, u.token)).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 429, 429]);
  /* заявка остаётся и после удаления аккаунта */
  await A.call('POST', '/api/account/delete', { password: 'correct horse battery' }, u.token);
  assert.equal((await A.call('GET', '/api/admin/leads', null, adm.token)).body.leads.length, 5);
});
