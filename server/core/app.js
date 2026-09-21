'use strict';
/* Ядро API, не зависящее от среды: локальный сервер (server/index.js) и функция Vercel (api/index.mjs)
   переводят свой запрос в объект req и отдают ответ { status, body, headers }.
   req = { method, pathname, query, header(name), body(limit) → Promise<Buffer>, webRequest() → Request } */
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const auth = require('./auth.js');
const { makeCatalog, ApiError, LIMITS } = require('./catalog.js');
const { sqliteDriver, postgresDriver, migrate } = require('./db.js');
const { fsStorage, blobStorage } = require('./storage.js');
const T = require('../../public/shared/catalog-types.js');

/* ---------- сборка окружения ---------- */
async function fromEnv(env = process.env, { dataDir } = {}) {
  const onVercel = !!env.VERCEL;
  const dbUrl = env.DATABASE_URL || env.POSTGRES_URL;
  let db, storage;
  if (dbUrl) { const { neon } = await import('@neondatabase/serverless'); db = postgresDriver(neon, dbUrl); }
  else if (onVercel) throw new ApiError(503, 'setup', 'Не подключена база данных: добавьте Neon (Storage → Postgres) в проект Vercel — появится переменная DATABASE_URL — и сделайте Redeploy.');
  else { fs.mkdirSync(dataDir, { recursive: true }); db = sqliteDriver(path.join(dataDir, 'planner.sqlite')); }
  /* Blob: либо статический токен BLOB_READ_WRITE_TOKEN, либо OIDC (так Vercel подключает новые store: STORE_ID + автоматический
     OIDC‑токен функции). Store может быть подключён с другим префиксом (напр. BLOB_READ_WRITE_TOKEN_STORE_ID) — ищем любой BLOB…_STORE_ID. */
  const storeKey = env.BLOB_STORE_ID ? 'BLOB_STORE_ID' : Object.keys(env).find(k => /^BLOB\w*_STORE_ID$/.test(k) && env[k]);
  const blobStoreId = storeKey ? env[storeKey] : '';
  if (blobStoreId && !process.env.BLOB_STORE_ID) process.env.BLOB_STORE_ID = blobStoreId; // SDK читает именно это имя
  if (env.BLOB_READ_WRITE_TOKEN || blobStoreId) {
    const sdk = await import('@vercel/blob');
    storage = blobStorage(sdk);
    storage.auth = env.BLOB_READ_WRITE_TOKEN ? 'token' : 'oidc';
  }
  else if (onVercel) throw new ApiError(503, 'setup', 'Не подключено хранилище файлов: создайте Blob store (Storage → Blob, доступ Public) в проекте Vercel и сделайте Redeploy.');
  else storage = fsStorage(path.join(dataDir, 'uploads'));
  return { db, storage, env, dataDir, onVercel };
}

/* Администратор из переменных окружения ADMIN_EMAIL / ADMIN_PASSWORD.
   В базе хранится солёный отпечаток пары «почта + пароль», с которой администратор был создан или обновлён.
   Пока переменные не меняются — пароль, заданный в админ‑панели, сохраняется.
   Изменили переменную (другой пароль или почта) и сделали Redeploy — пароль этого администратора
   переписывается значением из переменной (так же восстанавливается забытый пароль). */
async function syncEnvAdmin(ctx) {
  const { db, env } = ctx;
  let email = String(env.ADMIN_EMAIL || '').trim().toLowerCase();
  let pw = String(env.ADMIN_PASSWORD || '').replace(/[\r\n]+$/, '');
  if (email && pw) {
    const sig = await db.get("SELECT value FROM settings WHERE key='env_admin'");
    if (sig && auth.verifyPassword(email + '\n' + pw, sig.value)) return; // уже применено
    const u = await db.get('SELECT id, role FROM users WHERE email=?', [email]);
    if (u) {
      await db.run("UPDATE users SET password_hash=?, role='admin', disabled=0 WHERE id=?", [auth.hashPassword(pw), u.id]);
      await db.run('DELETE FROM sessions WHERE user_id=?', [u.id]);
      console.log(`Администратор ${email}: пароль обновлён из ADMIN_PASSWORD`);
    } else {
      try { await auth.createUser(db, { email, password: pw, role: 'admin', name: 'Администратор' }); console.log(`Администратор создан: ${email}`); }
      catch (e) { if (!/unique|duplicate/i.test(e.message)) throw e; } // параллельный холодный старт уже создал
    }
    await db.run("INSERT INTO settings (key, value) VALUES ('env_admin', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [auth.hashPassword(email + '\n' + pw)]);
    return;
  }
  const admins = Number((await db.get("SELECT CAST(COUNT(*) AS INTEGER) AS c FROM users WHERE role='admin'")).c);
  if (admins) return;
  if (ctx.onVercel) { ctx.setupProblem = 'Администратор не создан: задайте ADMIN_EMAIL и ADMIN_PASSWORD в Settings → Environment Variables проекта Vercel и сделайте Redeploy.'; return; }
  email = email || 'admin@local'; pw = crypto.randomBytes(9).toString('base64url');
  await auth.createUser(db, { email, password: pw, role: 'admin', name: 'Администратор' });
  fs.writeFileSync(path.join(ctx.dataDir, 'admin-credentials.txt'), `Администратор создан: ${email} / ${pw}\nСмените пароль и удалите этот файл.\n`);
  console.log(`Администратор создан: ${email} / ${pw}`);
}

async function bootstrap(ctx) {
  const { db, env } = ctx;
  await migrate(db);
  await syncEnvAdmin(ctx);
  await ctx.catalog.backfillSearch();
  const products = Number((await db.get('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM products')).c);
  if (!products && env.SEED_DEMO !== '0') { await ctx.catalog.seedDemo(); console.log('Каталог заполнен демо‑товарами.'); }
}

/* makeCtx — функция, возвращающая Promise контекста (вызывается лениво, при первом запросе) */
function createApp(makeCtx) {
  let ready = null;
  const init = () => ready || (ready = (async () => {
    const ctx = await makeCtx();
    ctx.catalog = makeCatalog(ctx.db, ctx.storage);
    await bootstrap(ctx);
    return ctx;
  })().catch(e => { ready = null; throw e; }));

  /* ---------- маршруты ---------- */
  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler });
  };
  const readJson = async (req) => {
    const b = await req.body(1024 * 1024);
    if (!b.length) return {};
    try { return JSON.parse(b.toString('utf8')); } catch { throw new ApiError(400, 'bad_json', 'Некорректный JSON'); }
  };
  async function requireUser(ctx, req, role) {
    const u = await auth.userFromToken(ctx.db, req.header('authorization'));
    if (!u) throw new ApiError(401, 'unauthorized', 'Нужно войти');
    if (role && u.role !== role) throw new ApiError(403, 'forbidden', 'Недостаточно прав');
    return u;
  }
  const admin = (fn) => async (ctx, req, p, q) => fn(ctx, await requireUser(ctx, req, 'admin'), req, p, q);
  const withDetails = async (ctx, id) => { const r = await ctx.catalog.row(id); return { ...(await ctx.catalog.dto(r)), publishProblems: ctx.catalog.publishProblems(r) }; };

  // служебное
  route('GET', '/api/health', async (ctx) => ({ ok: true, db: ctx.db.dialect, storage: ctx.storage.kind, setup: ctx.setupProblem || null }));
  route('GET', '/api/config', async (ctx) => ({ uploads: ctx.storage.kind === 'blob' ? 'blob' : 'direct', blobAuth: ctx.storage.auth || null, maxModelMb: 50, maxImageMb: 15 }));

  // авторизация
  route('POST', '/api/auth/login', async (ctx, req) => {
    if (ctx.setupProblem) throw new ApiError(503, 'setup', ctx.setupProblem);
    const b = await readJson(req);
    const r = await auth.login(ctx.db, b.email, b.password);
    if (!r) throw new ApiError(401, 'bad_credentials', 'Неверная почта или пароль');
    return r;
  });
  route('POST', '/api/auth/logout', async (ctx, req) => { const u = await requireUser(ctx, req); await auth.logout(ctx.db, u.token); return { ok: true }; });
  route('GET', '/api/auth/me', async (ctx, req) => ({ user: await requireUser(ctx, req) }));
  route('POST', '/api/auth/password', async (ctx, req) => {
    const u = await requireUser(ctx, req); const b = await readJson(req);
    const row = await ctx.db.get('SELECT password_hash FROM users WHERE id=?', [u.id]);
    if (!auth.verifyPassword(String(b.current || ''), row.password_hash)) throw new ApiError(422, 'bad_credentials', 'Текущий пароль неверен');
    if (String(b.next || '').length < 8) throw new ApiError(422, 'validation', 'Новый пароль — от 8 символов');
    await ctx.db.run('UPDATE users SET password_hash=? WHERE id=?', [auth.hashPassword(b.next), u.id]);
    await ctx.db.run('DELETE FROM sessions WHERE user_id=? AND token<>?', [u.id, u.token]);
    return { ok: true };
  });
  route('POST', '/api/auth/register', async () => { throw new ApiError(501, 'not_implemented', 'Регистрация компаний и клиентов появится на следующем этапе'); });

  // публичный каталог
  route('GET', '/api/catalog/types', async () => ({ cats: T.CATS, dimNames: T.DIMN, types: T.TYPES.map(t => ({ id: t.id, name: t.name, cats: t.cats, mount: t.mount, forms: t.forms.map(f => ({ id: f.id, name: f.name, fp: f.fp, dims: T.formDimKeys(f), typical: f.typical })) })) }));
  route('GET', '/api/catalog/products', async (ctx) => ({ products: await ctx.catalog.publicList() }));

  // админ: товары
  route('GET', '/api/admin/stats', admin((ctx) => ctx.catalog.stats()));
  route('GET', '/api/admin/products', admin((ctx, u, req, p, q) => ctx.catalog.list(q)));
  route('POST', '/api/admin/products', admin(async (ctx, u, req) => ctx.catalog.create(u, await readJson(req))));
  route('GET', '/api/admin/products/:id', admin((ctx, u, req, p) => withDetails(ctx, p.id)));
  route('PATCH', '/api/admin/products/:id', admin(async (ctx, u, req, p) => ctx.catalog.update(u, p.id, await readJson(req))));
  route('DELETE', '/api/admin/products/:id', admin(async (ctx, u, req, p) => { await ctx.catalog.remove(u, p.id); return { ok: true }; }));
  for (const action of ['publish', 'unpublish', 'reject', 'archive']) {
    route('POST', `/api/admin/products/:id/${action}`, admin(async (ctx, u, req, p) => ctx.catalog.transition(u, p.id, action, await readJson(req), auth.can)));
  }
  // 3D‑модель: напрямую (локально) или через Vercel Blob (commit)
  route('PUT', '/api/admin/products/:id/model', admin(async (ctx, u, req, p) => ctx.catalog.attachModel(u, p.id, await req.body(LIMITS.glbBytes))));
  route('POST', '/api/admin/products/:id/model/commit', admin(async (ctx, u, req, p) => {
    const { url } = await readJson(req);
    if (!ctx.storage.owns(url, `products/${p.id}/`)) throw new ApiError(400, 'bad_url', 'Файл не из хранилища этого товара');
    return ctx.catalog.attachModel(u, p.id, await ctx.storage.read(url), url);
  }));
  route('DELETE', '/api/admin/products/:id/model', admin((ctx, u, req, p) => ctx.catalog.deleteModel(u, p.id)));
  route('POST', '/api/admin/products/:id/model/fit-dims', admin((ctx, u, req, p) => ctx.catalog.fitDimsToModel(u, p.id)));
  route('POST', '/api/admin/products/:id/model/generate', admin((ctx) => ctx.catalog.requestGeneration()));
  // фото
  route('POST', '/api/admin/products/:id/images', admin(async (ctx, u, req, p) => ctx.catalog.attachImage(u, p.id, await req.body(LIMITS.imageBytes))));
  route('POST', '/api/admin/products/:id/images/commit', admin(async (ctx, u, req, p) => {
    const { url } = await readJson(req);
    if (!ctx.storage.owns(url, `products/${p.id}/`)) throw new ApiError(400, 'bad_url', 'Файл не из хранилища этого товара');
    return ctx.catalog.attachImage(u, p.id, await ctx.storage.read(url), url);
  }));
  route('DELETE', '/api/admin/products/:id/images/:img', admin((ctx, u, req, p) => ctx.catalog.deleteImage(u, p.id, p.img)));
  route('POST', '/api/admin/products/:id/images/:img/move', admin(async (ctx, u, req, p) => ctx.catalog.moveImage(u, p.id, p.img, (await readJson(req)).dir)));
  route('POST', '/api/admin/demo/purge', admin(async (ctx, u) => ({ deleted: await ctx.catalog.purgeDemo(u) })));
  route('GET', '/api/admin/audit', admin(async (ctx, u, req, p, q) => ({ items: await ctx.db.all('SELECT a.*, u.email FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.at DESC, a.id DESC LIMIT ?', [Math.min(+q.limit || 100, 500)]) })));

  /* Загрузка файлов из браузера прямо в Vercel Blob (обход лимита 4,5 МБ на запрос к функции).
     Браузер получает здесь одноразовый токен; права проверяются по токену сессии в clientPayload. */
  route('POST', '/api/admin/blob-upload', async (ctx, req) => {
    if (ctx.storage.kind !== 'blob') throw new ApiError(400, 'not_blob', 'Хранилище Blob не подключено');
    const client = await import('@vercel/blob/client');
    const oidc = ctx.storage.auth === 'oidc';
    // handleUpload требует статический токен; при OIDC — presigned‑поток (handleUploadPresigned + uploadPresigned в браузере)
    const handler = oidc ? client.handleUploadPresigned : client.handleUpload;
    if (typeof handler !== 'function') throw new ApiError(500, 'blob_sdk', 'Версия @vercel/blob не поддерживает ' + (oidc ? 'handleUploadPresigned' : 'handleUpload') + ': обновите зависимость и сделайте Redeploy');
    const body = await readJson(req);
    try {
      return await handler({
        body, request: req.webRequest(),
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          let cp = {}; try { cp = JSON.parse(clientPayload || '{}'); } catch {}
          const u = await auth.userFromToken(ctx.db, 'Bearer ' + (cp.token || ''));
          if (!u || u.role !== 'admin') throw new Error('Нужно войти как администратор');
          await ctx.catalog.row(cp.productId);
          if (!String(pathname).startsWith(`products/${cp.productId}/`)) throw new Error('Неверный путь файла');
          const model = cp.kind === 'model';
          return {
            allowedContentTypes: model ? ['model/gltf-binary', 'application/octet-stream'] : ['image/jpeg', 'image/png', 'image/webp'],
            maximumSizeInBytes: model ? LIMITS.glbBytes : LIMITS.imageBytes,
            addRandomSuffix: true,
            ...(oidc ? {} : { tokenPayload: JSON.stringify({ productId: cp.productId, kind: cp.kind, userId: u.id }) }),
          };
        },
        onUploadCompleted: async () => { /* файл привязывается к товару вызовом …/commit из админ‑панели */ },
      });
    } catch (e) { throw new ApiError(400, 'upload_denied', e.message); }
  });

  // кабинет компании — заложено
  route('GET', '/api/company/products', async () => { throw new ApiError(501, 'not_implemented', 'Кабинет компании появится на следующем этапе'); });

  /* ---------- обработчик ---------- */
  async function handle(req) {
    try {
      const matching = routes.filter(r => r.re.test(req.pathname));
      if (!matching.length) throw new ApiError(404, 'not_found', 'Нет такого метода API');
      const r = matching.find(x => x.method === req.method);
      if (!r) throw new ApiError(405, 'method_not_allowed', 'Метод не поддерживается');
      const ctx = await init();
      const m = r.re.exec(req.pathname); const params = {}; r.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
      const body = await r.handler(ctx, req, params, req.query);
      return { status: 200, body, headers: { 'Cache-Control': 'no-store' } };
    } catch (e) {
      if (e instanceof ApiError) return { status: e.status, body: { error: { code: e.code, message: e.message, details: e.details } } };
      console.error(e);
      return { status: 500, body: { error: { code: 'internal', message: 'Внутренняя ошибка сервера' } } };
    }
  }
  return { handle, init };
}

module.exports = { createApp, fromEnv, ApiError };
