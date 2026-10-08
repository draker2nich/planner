'use strict';
/* Общее для тестов сервера: приложение на временной базе SQLite, пользователь с сессией, запросы без сети. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, fromEnv } = require('../core/app.js');
const auth = require('../core/auth.js');

async function makeApp(env = {}, { aiFetch } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-test-'));
  let ctx;
  const app = createApp(async () => { ctx = await fromEnv({ AUTH_SECRET: 'test-secret', ...env }, { dataDir }); if (aiFetch) { ctx.aiFetch = aiFetch; ctx.aiSleep = async () => {}; } return ctx; }); // повторы при перегрузке модели в тестах не ждут
  await app.init();
  /* Каталог теста — только свои товары: при запуске сервер мог записать набор public/catalog-pack или демо‑товары */
  const setCatalog = async (products) => {
    await ctx.db.run('DELETE FROM product_images'); await ctx.db.run('DELETE FROM products');
    const t = new Date().toISOString();
    for (const p of products) {
      await ctx.db.run(`INSERT INTO products (id,source,type_id,form_id,name,brand,price,currency,dims,colors,materials,style_tags,status,model_status,created_at,updated_at,search)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [p.id, 'admin', p.typeId, p.formId, p.name || p.id, p.brand || 'Марка', p.price ?? 100, p.currency || 'BYN', JSON.stringify(p.dims), JSON.stringify(p.colors || []), JSON.stringify(p.materials || []),
        JSON.stringify(p.styleTags || []), p.status || 'published', p.model === false ? 'none' : 'ready', t, t, (p.name || p.id).toLowerCase()]);
    }
  };
  const call = async (method, pathname, body, token, query = {}) => {
    const buf = body == null ? Buffer.alloc(0) : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const r = await app.handle({ method, pathname, query, ip: '127.0.0.1', ipResolved: true,
      header: (n) => (n.toLowerCase() === 'authorization' && token ? 'Bearer ' + token : undefined),
      body: async (limit) => { if (buf.length > limit) { const { ApiError } = require('../core/app.js'); throw new ApiError(413, 'too_large', 'Слишком большой запрос'); } return buf; } });
    return r;
  };
  const user = async (email, { role = 'client', verified = true } = {}) => {
    const id = await auth.createUser(ctx.db, { email, password: 'correct horse battery', role, name: 'Тест', verified });
    const s = await auth.createSession(ctx.db, await ctx.db.get('SELECT * FROM users WHERE id=?', [id]));
    return { id, token: s.token };
  };
  return { app, call, user, setCatalog, get ctx() { return ctx; }, close: () => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} } };
}
module.exports = { makeApp };
