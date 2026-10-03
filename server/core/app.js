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
const V = require('../../public/shared/validation.js');
const { makeLimiter, clientIp } = require('./ratelimit.js');
const { makeProjects, PROJECT_MAX_BYTES } = require('./projects.js');
const { makeMailer, baseUrl, maskEmail } = require('./mail.js');
const { makeTokens } = require('./tokens.js');
const { makeOAuth, OAuthError, PROVIDERS } = require('./oauth.js');
const { makeUsers } = require('./users.js');

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

/* Соль для HMAC адресов в лимитах: AUTH_SECRET или случайная строка, сохранённая в settings */
async function authSecret(ctx) {
  if (ctx.env.AUTH_SECRET) return String(ctx.env.AUTH_SECRET);
  const row = await ctx.db.get("SELECT value FROM settings WHERE key='auth_secret'");
  if (row) return row.value;
  const v = crypto.randomBytes(32).toString('hex');
  await ctx.db.run("INSERT INTO settings (key, value) VALUES ('auth_secret', ?) ON CONFLICT (key) DO NOTHING", [v]);
  return (await ctx.db.get("SELECT value FROM settings WHERE key='auth_secret'")).value;
}

async function bootstrap(ctx) {
  const { db, env } = ctx;
  await migrate(db);
  const secret = await authSecret(ctx);
  ctx.limiter = makeLimiter(db, secret);
  ctx.projects = makeProjects(db);
  ctx.users = makeUsers(db);
  ctx.tokens = makeTokens(db);
  ctx.mailer = makeMailer(ctx);
  ctx.baseUrl = baseUrl(ctx);
  ctx.audit = (userId, action, entity, entityId, data = {}) => db.run('INSERT INTO audit_log (user_id, action, entity, entity_id, data, at) VALUES (?,?,?,?,?,?)', [userId, action, entity, entityId, JSON.stringify(data), new Date().toISOString()]);
  ctx.oauth = makeOAuth(ctx, { baseUrl: ctx.baseUrl, secret, audit: ctx.audit, registrationOpen: () => registrationOpen(ctx) });
  await syncEnvAdmin(ctx);
  await ctx.catalog.backfillSearch();
  const products = Number((await db.get('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM products')).c);
  if (!products && env.SEED_DEMO !== '0') { await ctx.catalog.seedDemo(); console.log('Каталог заполнен демо‑товарами.'); }
}

const registrationOpen = (ctx) => String(ctx.env.REGISTRATION_ENABLED ?? '1').trim() !== '0';
/* Жёсткий режим: без подтверждённой почты проекты в аккаунт не сохраняются. При выключенной почте игнорируется. */
const requireVerified = (ctx) => String(ctx.env.REQUIRE_VERIFIED_EMAIL || '').trim() === '1' && ctx.mailer.enabled;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* Ответ с произвольным статусом и заголовками (перенаправления входа через провайдера) */
class Reply { constructor(status, headers = {}, body = null) { this.status = status; this.headers = headers; this.body = body; } }
const contactEmail = (ctx) => { const s = String(ctx.env.CONTACT_EMAIL || '').trim(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null; };

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
  const readJson = async (req, limit = 1024 * 1024) => {
    const b = await req.body(limit);
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
  route('GET', '/api/config', async (ctx) => ({ uploads: ctx.storage.kind === 'blob' ? 'blob' : 'direct', blobAuth: ctx.storage.auth || null, maxModelMb: 50, maxImageMb: 15,
    registration: registrationOpen(ctx), contactEmail: contactEmail(ctx), termsVersion: V.TERMS_VERSION,
    mail: ctx.mailer.enabled, oauth: ctx.oauth.list(), requireVerifiedEmail: requireVerified(ctx) }));

  // авторизация
  const tooMany = (retryAfter) => {
    const min = Math.max(1, Math.ceil(retryAfter / 60));
    return new ApiError(429, 'rate_limited', `Слишком много попыток. Попробуйте через ${min} мин`, { retryAfter }, { 'Retry-After': String(retryAfter) });
  };
  route('POST', '/api/auth/login', async (ctx, req) => {
    if (ctx.setupProblem) throw new ApiError(503, 'setup', ctx.setupProblem);
    const b = await readJson(req, 16 * 1024);
    const L = ctx.limiter; const ip = L.tag(clientIp(req)); const em = L.tag(V.normEmail(b.email));
    const kPair = `login:pair:${ip}:${em}`, kIp = `login:ip:${ip}`;
    for (const [k, lim, win] of [[kPair, 10, 900], [kIp, 50, 3600]]) { const c = await L.peek(k, lim, win); if (!c.ok) throw tooMany(c.retryAfter); }
    const r = await auth.login(ctx.db, b.email, b.password);
    if (!r) {
      await L.hit(kPair, 10, 900); await L.hit(kIp, 50, 3600);
      throw new ApiError(401, 'bad_credentials', 'Неверная почта или пароль');
    }
    await L.reset(kPair);
    return r;
  });
  route('POST', '/api/auth/logout', async (ctx, req) => { const u = await requireUser(ctx, req); await auth.logout(ctx.db, u.token); return { ok: true }; });
  route('GET', '/api/auth/me', async (ctx, req) => ({ user: await requireUser(ctx, req) }));
  /* Смена пароля; у аккаунта без пароля (вход через провайдера) текущий пароль не требуется */
  route('POST', '/api/auth/password', async (ctx, req) => {
    const u = await requireUser(ctx, req); const b = await readJson(req, 16 * 1024);
    const row = await ctx.db.get('SELECT password_hash FROM users WHERE id=?', [u.id]);
    if (auth.hasPassword(row.password_hash)) {
      const cur = String(b.current || '');
      if (!cur || cur.length > 1024 || !auth.verifyPassword(cur, row.password_hash)) throw new ApiError(422, 'bad_credentials', 'Текущий пароль неверен', { fields: { current: 'Текущий пароль неверен' } });
    }
    const err = V.validatePassword(b.next, u.email);
    if (err) throw new ApiError(422, 'validation', err, { fields: { next: err } });
    await ctx.db.run('UPDATE users SET password_hash=?, updated_at=? WHERE id=?', [auth.hashPassword(V.normPassword(b.next)), new Date().toISOString(), u.id]);
    await ctx.db.run('DELETE FROM sessions WHERE user_id=? AND token<>?', [u.id, u.token]);
    await ctx.tokens.dropUnused(u.id, ['reset']);
    await ctx.mailer.sendQuiet('password_changed', u, {});
    return { ok: true };
  });

  /* ---------- подтверждение почты (ТЗ этапа 2, раздел 3) ---------- */
  const sendVerify = async (ctx, u, quiet) => {
    const raw = await ctx.tokens.create(u.id, 'verify');
    const link = `${ctx.baseUrl}/verify?token=${raw}`;
    return quiet ? ctx.mailer.sendQuiet('verify', u, { link }) : ctx.mailer.send('verify', u, { link });
  };
  const tokenError = (state) => state === 'expired' ? new ApiError(410, 'token_expired', 'Ссылка устарела') : new ApiError(404, 'token_invalid', 'Ссылка недействительна');
  const tokenLimit = async (ctx, req) => { const lim = await ctx.limiter.hit(`tok:ip:${ctx.limiter.tag(clientIp(req))}`, 20, 900); if (!lim.ok) throw tooMany(lim.retryAfter); };

  route('POST', '/api/auth/verify', async (ctx, req) => {
    await tokenLimit(ctx, req);
    const b = await readJson(req, 16 * 1024);
    const f = await ctx.tokens.find(b.token, 'verify');
    if (f.state === 'used' && f.user.email_verified_at) return { ok: true, already: true, email: maskEmail(f.user.email) };
    if (f.state !== 'ok') throw tokenError(f.state);
    if (!(await ctx.tokens.consume(b.token, 'verify'))) throw tokenError('invalid');
    const already = !!f.user.email_verified_at;
    if (!already) {
      await ctx.db.run('UPDATE users SET email_verified_at=?, updated_at=? WHERE id=?', [new Date().toISOString(), new Date().toISOString(), f.user.id]);
      await ctx.audit(f.user.id, 'user.verify', 'user', f.user.id);
    }
    return { ok: true, already, email: maskEmail(f.user.email) };
  });
  route('POST', '/api/auth/verify/resend', async (ctx, req) => {
    const u = await requireUser(ctx, req);
    if (u.emailVerified) return { ok: true, already: true };
    if (!ctx.mailer.enabled) throw new ApiError(503, 'mail_disabled', 'Отправка писем не настроена');
    for (const [k, lim, win] of [[`verify:min:${u.id}`, 1, 60], [`verify:day:${u.id}`, 5, 86400]]) { const c = await ctx.limiter.peek(k, lim, win); if (!c.ok) throw tooMany(c.retryAfter); }
    await ctx.limiter.hit(`verify:min:${u.id}`, 1, 60); await ctx.limiter.hit(`verify:day:${u.id}`, 5, 86400);
    try { await sendVerify(ctx, u, false); }
    catch (e) { console.error(`Не удалось отправить письмо verify для ${maskEmail(u.email)}: ${e.message}`); throw new ApiError(502, 'mail_failed', 'Не удалось отправить письмо, попробуйте позже'); }
    return { ok: true };
  });

  /* ---------- восстановление пароля (ТЗ этапа 2, раздел 4) ---------- */
  route('POST', '/api/auth/password/forgot', async (ctx, req) => {
    if (!ctx.mailer.enabled) throw new ApiError(503, 'mail_disabled', 'Восстановление пароля по почте не настроено');
    const L = ctx.limiter;
    const lim = await L.hit(`forgot:ip:${L.tag(clientIp(req))}`, 5, 3600);
    if (!lim.ok) throw tooMany(lim.retryAfter);
    const b = await readJson(req, 16 * 1024);
    const email = V.normEmail(b.email);
    const bad = V.validateEmail(email);
    if (bad) throw new ApiError(422, 'validation', bad, { fields: { email: bad } });
    /* ответ одинаков по тексту, коду и времени — существование аккаунта не раскрывается */
    const pad = ctx.env.AUTH_PAD_MS != null ? Number(ctx.env.AUTH_PAD_MS) : 600 + Math.floor(Math.random() * 200);
    const work = (async () => {
      const perEmail = await L.hit(`forgot:em:${L.tag(email)}`, 3, 3600);
      if (!perEmail.ok) return; // чужой ящик нельзя завалить письмами
      const u = await ctx.db.get('SELECT * FROM users WHERE email=?', [email]);
      if (!u || Number(u.disabled)) return;
      const raw = await ctx.tokens.create(u.id, 'reset');
      await ctx.mailer.sendQuiet('reset', u, { link: `${ctx.baseUrl}/reset?token=${raw}` });
    })().catch((e) => console.error('forgot:', e.message));
    await Promise.all([work, sleep(pad)]);
    return { ok: true };
  });
  route('POST', '/api/auth/password/reset/check', async (ctx, req) => {
    await tokenLimit(ctx, req);
    const b = await readJson(req, 16 * 1024);
    const f = await ctx.tokens.find(b.token, 'reset');
    if (f.state !== 'ok') throw tokenError(f.state === 'used' ? 'invalid' : f.state);
    return { ok: true, email: maskEmail(f.user.email) };
  });
  route('POST', '/api/auth/password/reset', async (ctx, req) => {
    await tokenLimit(ctx, req);
    const b = await readJson(req, 16 * 1024);
    const f = await ctx.tokens.find(b.token, 'reset');
    if (f.state !== 'ok') throw tokenError(f.state === 'used' ? 'invalid' : f.state);
    const err = V.validatePassword(b.password, f.user.email);
    if (err) throw new ApiError(422, 'validation', err, { fields: { password: err } });
    if (!(await ctx.tokens.consume(b.token, 'reset'))) throw tokenError('invalid');
    const t = new Date().toISOString();
    await ctx.db.run('UPDATE users SET password_hash=?, email_verified_at=COALESCE(email_verified_at, ?), updated_at=? WHERE id=?', [auth.hashPassword(V.normPassword(b.password)), t, t, f.user.id]);
    await ctx.db.run('DELETE FROM sessions WHERE user_id=?', [f.user.id]);
    await ctx.tokens.dropUnused(f.user.id, ['verify']);
    await ctx.limiter.resetSuffix('login:pair:', ':' + ctx.limiter.tag(f.user.email));
    await ctx.audit(f.user.id, 'user.password_reset', 'user', f.user.id);
    await ctx.mailer.sendQuiet('password_changed', f.user, {});
    return auth.createSession(ctx.db, await ctx.db.get('SELECT * FROM users WHERE id=?', [f.user.id]));
  });

  /* ---------- вход через Google и Яндекс (ТЗ этапа 2, раздел 5) ---------- */
  const loginRedirect = (ctx, params, cookie) => new Reply(302, { Location: `${ctx.baseUrl}/login?${new URLSearchParams(params)}`, ...(cookie ? { 'Set-Cookie': cookie } : {}) });
  route('GET', '/api/auth/oauth/:provider/start', async (ctx, req, p, q) => {
    if (!PROVIDERS[p.provider]) throw new ApiError(404, 'not_found', 'Нет такого способа входа');
    try { const s = ctx.oauth.start(p.provider, q.next); return new Reply(302, { Location: s.url, 'Set-Cookie': s.cookie }); }
    catch (e) { if (e instanceof OAuthError) return loginRedirect(ctx, { oauth_error: e.code, provider: p.provider }); throw e; }
  });
  route('GET', '/api/auth/oauth/:provider/callback', async (ctx, req, p, q) => {
    if (!PROVIDERS[p.provider]) throw new ApiError(404, 'not_found', 'Нет такого способа входа');
    const clear = ctx.oauth.clearCookie();
    try {
      const lim = await ctx.limiter.hit(`oauth:ip:${ctx.limiter.tag(clientIp(req))}`, 30, 3600);
      if (!lim.ok) throw new OAuthError('rate_limited');
      if (ctx.setupProblem) throw new OAuthError('provider');
      const { profile, next } = await ctx.oauth.callback(p.provider, q, req.header('cookie'));
      const { user, created } = await ctx.oauth.resolve(p.provider, profile);
      const code = await ctx.tokens.create(user.id, 'oauth', { created });
      return loginRedirect(ctx, { oauth: code, ...(next ? { next } : {}) }, clear);
    } catch (e) {
      if (e instanceof OAuthError) return loginRedirect(ctx, { oauth_error: e.code, provider: p.provider }, clear);
      console.error(e);
      return loginRedirect(ctx, { oauth_error: 'provider', provider: p.provider }, clear);
    }
  });
  route('POST', '/api/auth/oauth/exchange', async (ctx, req) => {
    const lim = await ctx.limiter.hit(`oauth:ip:${ctx.limiter.tag(clientIp(req))}`, 30, 3600);
    if (!lim.ok) throw tooMany(lim.retryAfter);
    const b = await readJson(req, 16 * 1024);
    const f = await ctx.tokens.find(b.code, 'oauth');
    if (f.state !== 'ok' || !(await ctx.tokens.consume(b.code, 'oauth'))) throw new ApiError(400, 'oauth_code', 'Сеанс входа устарел. Попробуйте ещё раз');
    return { ...(await auth.createSession(ctx.db, f.user)), created: !!f.meta.created };
  });

  /* Регистрация клиента. Роль всегда client; после успеха — сразу сессия (ответ как у входа). */
  route('POST', '/api/auth/register', async (ctx, req) => {
    if (ctx.setupProblem) throw new ApiError(503, 'setup', ctx.setupProblem);
    if (!registrationOpen(ctx)) throw new ApiError(403, 'registration_closed', 'Регистрация временно закрыта');
    const L = ctx.limiter; const ipTag = L.tag(clientIp(req));
    const lim = await L.hit(`reg:ip:${ipTag}`, 5, 3600);
    if (!lim.ok) throw tooMany(lim.retryAfter);
    const b = await readJson(req, 16 * 1024);
    if (b.website) {
      await ctx.audit(null, 'user.register_rejected', 'user', null, { ip: ipTag.slice(0, 12), reason: 'honeypot' });
      throw new ApiError(422, 'rejected', 'Не удалось создать аккаунт');
    }
    const v = V.validateRegistration(b);
    if (!v.ok) throw new ApiError(422, 'validation', Object.values(v.fields)[0], { fields: v.fields });
    const taken = () => new ApiError(409, 'email_taken', 'Эта почта уже зарегистрирована', { fields: { email: 'Эта почта уже зарегистрирована' } });
    if (await ctx.db.get('SELECT id FROM users WHERE email=?', [v.values.email])) throw taken();
    let id;
    try {
      id = await auth.createUser(ctx.db, { email: v.values.email, password: v.values.password, role: 'client', name: v.values.name,
        terms: { acceptedAt: new Date().toISOString(), version: V.TERMS_VERSION }, marketing: v.values.marketing });
    } catch (e) { if (/unique|duplicate/i.test(e.message)) throw taken(); throw e; }
    const u = await ctx.db.get('SELECT * FROM users WHERE id=?', [id]);
    await ctx.audit(id, 'user.register', 'user', id, { ip: ipTag.slice(0, 12) });
    if (ctx.mailer.enabled) await sendVerify(ctx, u, true); // сбой письма регистрацию не отменяет
    return auth.createSession(ctx.db, u);
  });

  /* ---------- аккаунт (ТЗ этапа 2, раздел 6) ---------- */
  route('GET', '/api/account', async (ctx, req) => ctx.users.account(await requireUser(ctx, req)));
  route('PATCH', '/api/account', async (ctx, req) => ctx.users.rename(await requireUser(ctx, req), await readJson(req, 16 * 1024)));
  route('POST', '/api/account/sessions/revoke', async (ctx, req) => ctx.users.revokeOtherSessions(await requireUser(ctx, req)));
  route('POST', '/api/account/delete', async (ctx, req) => {
    const u = await requireUser(ctx, req);
    if (u.role !== 'client') throw new ApiError(403, 'forbidden', u.role === 'admin' ? 'Учётная запись администратора управляется переменными окружения' : 'Удаление аккаунта компании появится вместе с кабинетом компании');
    const key = `del:${u.id}`;
    const peek = await ctx.limiter.peek(key, 5, 900); if (!peek.ok) throw tooMany(peek.retryAfter);
    const c = await ctx.users.confirmDeletion(u, await readJson(req, 16 * 1024));
    if (!c.ok) { await ctx.limiter.hit(key, 5, 900); throw new ApiError(422, 'bad_credentials', c.message, { fields: { [c.field]: c.message } }); }
    await ctx.users.remove(u.id);
    await ctx.limiter.reset(key);
    await ctx.audit(u.id, 'user.delete', 'user', u.id); // без почты и имени
    await ctx.mailer.sendQuiet('account_deleted', { email: c.row.email, name: c.row.name }, {});
    return { ok: true };
  });

  // проекты редактора в аккаунте
  const writer = async (ctx, req) => {
    const u = await requireUser(ctx, req);
    if (requireVerified(ctx) && !u.emailVerified && u.role !== 'admin') throw new ApiError(403, 'email_unverified', 'Подтвердите почту, чтобы сохранять проекты в аккаунт');
    return u;
  };
  const createLimit = async (ctx, u) => { const lim = await ctx.limiter.hit(`proj:new:${u.id}`, 30, 3600); if (!lim.ok) throw tooMany(lim.retryAfter); };
  const BODY = PROJECT_MAX_BYTES + 64 * 1024;
  route('GET', '/api/projects', async (ctx, req) => ctx.projects.list(await requireUser(ctx, req)));
  route('POST', '/api/projects', async (ctx, req) => { const u = await writer(ctx, req); await createLimit(ctx, u); return ctx.projects.create(u, await readJson(req, BODY)); });
  route('GET', '/api/projects/:id', async (ctx, req, p) => ctx.projects.get(await requireUser(ctx, req), p.id));
  route('PUT', '/api/projects/:id', async (ctx, req, p) => {
    const u = await writer(ctx, req);
    const lim = await ctx.limiter.hit(`proj:put:${u.id}`, 120, 60);
    if (!lim.ok) throw tooMany(lim.retryAfter);
    return ctx.projects.update(u, p.id, await readJson(req, BODY));
  });
  route('PATCH', '/api/projects/:id', async (ctx, req, p) => ctx.projects.rename(await writer(ctx, req), p.id, await readJson(req, 16 * 1024)));
  route('POST', '/api/projects/:id/copy', async (ctx, req, p) => { const u = await writer(ctx, req); await createLimit(ctx, u); return ctx.projects.copy(u, p.id); });
  route('DELETE', '/api/projects/:id', async (ctx, req, p) => ctx.projects.remove(await requireUser(ctx, req), p.id));

  // публичный каталог
  route('GET', '/api/catalog/types', async () => ({ cats: T.CATS, dimNames: T.DIMN, types: T.TYPES.map(t => ({ id: t.id, name: t.name, cats: t.cats, mount: t.mount, forms: t.forms.map(f => ({ id: f.id, name: f.name, fp: f.fp, dims: T.formDimKeys(f), typical: f.typical })) })) }));
  route('GET', '/api/catalog/products', async (ctx) => ({ products: await ctx.catalog.publicList() }));

  // админ: товары
  route('GET', '/api/admin/stats', admin(async (ctx) => ({ ...(await ctx.catalog.stats()), users: await ctx.users.total() })));

  // админ: пользователи (ТЗ этапа 2, раздел 8)
  route('GET', '/api/admin/users', admin((ctx, u, req, p, q) => ctx.users.list(q)));
  route('GET', '/api/admin/users/:id', admin((ctx, u, req, p) => ctx.users.get(p.id, ctx.projects)));
  route('POST', '/api/admin/users/:id/block', admin(async (ctx, u, req, p) => {
    const b = await readJson(req, 16 * 1024);
    const r = await ctx.users.block(u, p.id, b);
    await ctx.audit(u.id, 'user.block', 'user', r.row.id, { reason: r.reason });
    if (b.notify === true) await ctx.mailer.sendQuiet('blocked', r.row, { reason: r.reason });
    return ctx.users.get(p.id, ctx.projects);
  }));
  route('POST', '/api/admin/users/:id/unblock', admin(async (ctx, u, req, p) => {
    const row = await ctx.users.unblock(p.id);
    await ctx.audit(u.id, 'user.unblock', 'user', row.id);
    return ctx.users.get(p.id, ctx.projects);
  }));
  route('POST', '/api/admin/users/:id/sessions/revoke', admin(async (ctx, u, req, p) => {
    const r = await ctx.users.revokeSessions(p.id);
    await ctx.audit(u.id, 'user.sessions_revoke', 'user', r.row.id, { revoked: r.revoked });
    return ctx.users.get(p.id, ctx.projects);
  }));
  route('GET', '/api/admin/projects/:id', admin(async (ctx, u, req, p) => {
    const pr = await ctx.projects.adminGet(p.id);
    await ctx.audit(u.id, 'project.view', 'project', pr.id, { owner: pr.owner.id });
    return pr;
  }));
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
      const body = await r.handler(ctx, req, params, req.query || {});
      if (body instanceof Reply) return { status: body.status, body: body.body, headers: { 'Cache-Control': 'no-store', ...body.headers } };
      return { status: 200, body, headers: { 'Cache-Control': 'no-store' } };
    } catch (e) {
      if (e instanceof ApiError) return { status: e.status, body: { error: { code: e.code, message: e.message, details: e.details } }, headers: { 'Cache-Control': 'no-store', ...(e.headers || {}) } };
      console.error(e);
      return { status: 500, body: { error: { code: 'internal', message: 'Внутренняя ошибка сервера' } }, headers: { 'Cache-Control': 'no-store' } };
    }
  }
  return { handle, init };
}

module.exports = { createApp, fromEnv, ApiError };
