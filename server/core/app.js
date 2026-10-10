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
const { syncPack } = require('./pack.js');
const { makeAi, AiError } = require('./ai.js');
const designer = require('./designer.js');
const { mock: aiMock } = require('./ai-mock.js');
const { makeAiUsage } = require('./ai-usage.js');
const { makePhotos } = require('./photos.js');
const { makeLeads } = require('./leads.js');
const { makeImageAi } = require('./imagegen.js');
const rendersCore = require('./renders.js');

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
    if (pw.length < 12) console.warn('ADMIN_PASSWORD короче 12 символов: задайте длинный случайный пароль — от него зависит доступ ко всем данным.');
    if (sig && await auth.verifyPassword(email + '\n' + pw, sig.value)) return; // уже применено
    const u = await db.get('SELECT id, role FROM users WHERE email=?', [email]);
    if (u) {
      await db.run("UPDATE users SET password_hash=?, role='admin', disabled=0 WHERE id=?", [await auth.hashPassword(auth.normPassword(pw)), u.id]);
      await db.run('DELETE FROM sessions WHERE user_id=?', [u.id]);
      console.log(`Администратор ${email}: пароль обновлён из ADMIN_PASSWORD`);
    } else {
      try { await auth.createUser(db, { email, password: pw, role: 'admin', name: 'Администратор' }); console.log(`Администратор создан: ${email}`); }
      catch (e) { if (!/unique|duplicate/i.test(e.message)) throw e; } // параллельный холодный старт уже создал
    }
    await db.run("INSERT INTO settings (key, value) VALUES ('env_admin', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [await auth.hashPassword(email + '\n' + pw)]);
    return;
  }
  const admins = Number((await db.get("SELECT CAST(COUNT(*) AS INTEGER) AS c FROM users WHERE role='admin'")).c);
  if (admins) return;
  if (ctx.onVercel) { ctx.setupProblem = 'Администратор не создан: задайте ADMIN_EMAIL и ADMIN_PASSWORD в Settings → Environment Variables проекта Vercel и сделайте Redeploy.'; return; }
  email = email || 'admin@local'; pw = crypto.randomBytes(9).toString('base64url');
  await auth.createUser(db, { email, password: pw, role: 'admin', name: 'Администратор' });
  fs.writeFileSync(path.join(ctx.dataDir, 'admin-credentials.txt'), `Администратор создан: ${email} / ${pw}\nСмените пароль и удалите этот файл.\n`);
  /* пароль — только в файле: журнал сервера часто уходит в сторонние системы сбора логов */
  console.log(`Администратор создан: ${email}. Пароль записан в ${path.join(ctx.dataDir, 'admin-credentials.txt')}`);
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
  auth.configure({ adminSessionDays: env.ADMIN_SESSION_DAYS });
  const secret = await authSecret(ctx);
  ctx.limiter = makeLimiter(db, secret);
  ctx.projects = makeProjects(db);
  ctx.users = makeUsers(db);
  ctx.tokens = makeTokens(db);
  ctx.mailer = makeMailer(ctx);
  ctx.baseUrl = baseUrl(ctx);
  ctx.audit = (userId, action, entity, entityId, data = {}) => db.run('INSERT INTO audit_log (user_id, action, entity, entity_id, data, at) VALUES (?,?,?,?,?,?)', [userId, action, entity, entityId, JSON.stringify(data), new Date().toISOString()]);
  ctx.oauth = makeOAuth(ctx, { baseUrl: ctx.baseUrl, secret, audit: ctx.audit, registrationOpen: () => registrationOpen(ctx) });
  /* ИИ‑дизайнер: обращение к модели и пропуска генерации. ctx.aiFetch и ctx.aiSleep (пауза между повторами) подставляют тесты. */
  ctx.ai = makeAi(env, { mock: aiMock, ...(ctx.aiFetch ? { fetchFn: ctx.aiFetch } : {}), ...(ctx.aiSleep ? { sleepFn: ctx.aiSleep } : {}) });
  ctx.aiPasses = designer.makePasses(ctx.limiter.tag);
  ctx.aiSeals = designer.makeSeals(ctx.limiter.tag);
  ctx.aiUsage = makeAiUsage(db, env);
  ctx.photos = makePhotos(db, ctx.storage);
  /* Визуализация комнаты: модель, которая рисует изображения, и хранение готовых картинок. ctx.renderFetch подставляют тесты. */
  ctx.imageAi = makeImageAi(env, { mock: rendersCore.mock, ...(ctx.renderFetch ? { fetchFn: ctx.renderFetch } : {}), ...(ctx.aiSleep ? { sleepFn: ctx.aiSleep } : {}) });
  ctx.renders = rendersCore.makeRenders(db, ctx.storage);
  ctx.leads = makeLeads(db, ctx.catalog);
  /* Разовая доводка данных после миграции v7: сессии — в хешированный вид, строки поиска пользователей и заявок.
     Отметка в settings избавляет каждый холодный старт функции от трёх лишних запросов к базе. Повторный запуск безвреден. */
  if (!(await db.get("SELECT value FROM settings WHERE key='backfill_v7'"))) {
    /* порциями: на Neon каждая строка — отдельный запрос по сети, и большой объём не должен занять весь холодный старт.
       Что не успело — доделает следующий запуск; до тех пор старые сессии работают (userFromToken находит их и переводит сам). */
    const left = (await auth.migrateSessions(db, 200)).left + (await auth.backfillUserSearch(db, 200)).left + (await ctx.leads.backfillSearch(200)).left;
    if (!left) await db.run("INSERT INTO settings (key, value) VALUES ('backfill_v7', '1') ON CONFLICT (key) DO NOTHING");
  }
  if (!ctx.ai.enabled) console.log('ИИ‑дизайнер выключен: ' + ctx.ai.why);
  else {
    const own = Object.entries(ctx.ai.models).filter(([, m]) => m !== ctx.ai.model).map(([k, m]) => `${k} — ${m}`).join(', ');
    console.log(`ИИ‑дизайнер: ${ctx.ai.mock ? 'заглушка (AI_MOCK=1)' : ctx.ai.provider + ' · ' + ctx.ai.model + (own ? ` (по шагам: ${own})` : '')}`);
  }
  console.log(ctx.imageAi.enabled ? `Визуализация: ${ctx.imageAi.mock ? 'заглушка (RENDER_MOCK=1)' : `${ctx.imageAi.provider} · ${ctx.imageAi.model} · ${ctx.imageAi.size}`}` : 'Визуализация выключена: ' + ctx.imageAi.why);
  await syncEnvAdmin(ctx);
  await ctx.catalog.backfillSearch();
  /* набор каталога из public/catalog-pack; сбой записи набора не должен останавливать сайт */
  await syncPack(ctx).catch((e) => console.error('Набор каталога не записан в базу:', e.message));
  const products = Number((await db.get('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM products')).c);
  if (!products && env.SEED_DEMO !== '0') { await ctx.catalog.seedDemo(); console.log('Каталог заполнен демо‑товарами.'); }
}

const registrationOpen = (ctx) => String(ctx.env.REGISTRATION_ENABLED ?? '1').trim() !== '0';
/* Лимиты ИИ‑дизайнера: AI_DAILY_RUNS — генераций на пользователя в сутки, AI_DAILY_CALLS — обращений к модели в сутки на всю платформу */
const posInt = (v, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : d; };
const aiLimits = (ctx) => ({ runs: posInt(ctx.env.AI_DAILY_RUNS, 10), calls: posInt(ctx.env.AI_DAILY_CALLS, 2000), monthly: posInt(ctx.env.AI_MONTHLY_CALLS, 0) });
/* Лимиты визуализации: RENDER_DAILY — картинок на пользователя в сутки; RENDER_REFS — сколько фото товаров прикладывать к кадру (0 — не прикладывать).
   Общие пределы AI_DAILY_CALLS и AI_MONTHLY_CALLS считают и эти обращения: в журнале они лежат рядом с шагами ИИ‑дизайнера. */
const renderLimits = (ctx) => {
  const refs = Math.floor(Number(ctx.env.RENDER_REFS));
  return { daily: posInt(ctx.env.RENDER_DAILY, 5), refs: ctx.env.RENDER_REFS == null || ctx.env.RENDER_REFS === '' || !Number.isFinite(refs) ? 6 : Math.max(0, Math.min(rendersCore.LIM.refs, refs)) };
};
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
    mail: ctx.mailer.enabled, oauth: ctx.oauth.list(), requireVerifiedEmail: requireVerified(ctx),
    ai: { enabled: ctx.ai.enabled, mock: ctx.ai.mock, dailyRuns: aiLimits(ctx).runs },
    render: { enabled: ctx.imageAi.enabled, mock: ctx.imageAi.mock, daily: renderLimits(ctx).daily } }));

  // авторизация
  const tooMany = (retryAfter) => {
    const min = Math.max(1, Math.ceil(retryAfter / 60));
    return new ApiError(429, 'rate_limited', `Слишком много попыток. Попробуйте через ${min} мин`, { retryAfter }, { 'Retry-After': String(retryAfter) });
  };
  /* Занять попытку одним запросом к базе: параллельные запросы получают разные номера и не проходят лимит вместе
     (проверка «сначала прочитать, потом записать» это позволяла). Сбой базы лимитов вход не ломает — попытка пропускается. */
  const attempt = async (ctx, key, limit, windowSec) => {
    let c;
    try { c = await ctx.limiter.take(key, limit, windowSec); } catch (e) { console.error('rate limit:', e.message); return; }
    if (!c.ok) throw tooMany(c.retryAfter);
  };
  route('POST', '/api/auth/login', async (ctx, req) => {
    if (ctx.setupProblem) throw new ApiError(503, 'setup', ctx.setupProblem);
    const b = await readJson(req, 16 * 1024);
    const L = ctx.limiter; const ip = L.tag(clientIp(req)); const em = L.tag(V.normEmail(b.email));
    const kPair = `login:pair:${ip}:${em}`, kIp = `login:ip:${ip}`;
    /* попытка занимается до проверки пароля и возвращается после верного: в счёт идут только неудачные */
    await attempt(ctx, kPair, 10, 900);
    await attempt(ctx, kIp, 50, 3600);
    const r = await auth.login(ctx.db, b.email, b.password);
    if (!r) throw new ApiError(401, 'bad_credentials', 'Неверная почта или пароль');
    await L.reset(kPair); await L.undo(kIp);
    /* о блокировке узнаёт только тот, кто знает пароль, — существование аккаунта посторонним не раскрывается */
    if (r.blocked) throw new ApiError(403, 'blocked', 'Аккаунт заблокирован. Если это ошибка, напишите нам');
    return r;
  });
  route('POST', '/api/auth/logout', async (ctx, req) => { const u = await requireUser(ctx, req); await ctx.db.run('DELETE FROM sessions WHERE token=?', [u.sessionKey]); return { ok: true }; });
  route('GET', '/api/auth/me', async (ctx, req) => ({ user: await requireUser(ctx, req) }));
  /* Смена пароля; у аккаунта без пароля (вход через провайдера) текущий пароль не требуется */
  route('POST', '/api/auth/password', async (ctx, req) => {
    const u = await requireUser(ctx, req); const b = await readJson(req, 16 * 1024);
    const row = await ctx.db.get('SELECT password_hash FROM users WHERE id=?', [u.id]);
    if (auth.hasPassword(row.password_hash)) {
      /* украденный токен сессии не должен давать бесконечный перебор текущего пароля */
      const key = `pw:${u.id}`;
      await attempt(ctx, key, 5, 900);
      const cur = auth.normPassword(b.current);
      if (!cur || cur.length > 1024 || !(await auth.verifyPassword(cur, row.password_hash))) throw new ApiError(422, 'bad_credentials', 'Текущий пароль неверен', { fields: { current: 'Текущий пароль неверен' } });
      await ctx.limiter.reset(key);
    }
    const err = V.validatePassword(b.next, u.email);
    if (err) throw new ApiError(422, 'validation', err, { fields: { next: err } });
    await ctx.db.run('UPDATE users SET password_hash=?, updated_at=? WHERE id=?', [await auth.hashPassword(auth.normPassword(b.next)), new Date().toISOString(), u.id]);
    await ctx.db.run('DELETE FROM sessions WHERE user_id=? AND token<>?', [u.id, u.sessionKey]);
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
    await attempt(ctx, `verify:min:${u.id}`, 1, 60);
    await attempt(ctx, `verify:day:${u.id}`, 5, 86400);
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
    await ctx.db.run('UPDATE users SET password_hash=?, email_verified_at=COALESCE(email_verified_at, ?), updated_at=? WHERE id=?', [await auth.hashPassword(auth.normPassword(b.password)), t, t, f.user.id]);
    await ctx.db.run('DELETE FROM sessions WHERE user_id=?', [f.user.id]);
    /* почта до этого не была подтверждена: аккаунт мог завести посторонний (в том числе входом через провайдера
       с неподтверждённым адресом) — его способы входа снимаются, владельцем становится тот, кто получил письмо */
    if (!f.user.email_verified_at) await ctx.db.run('DELETE FROM user_identities WHERE user_id=?', [f.user.id]);
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
      await ctx.audit(null, 'user.register_rejected', 'user', null, { reason: 'honeypot' });
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
    await ctx.audit(id, 'user.register', 'user', id); // метка адреса в журнал не пишется: она живёт только в счётчиках лимитов, не дольше суток
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
    await attempt(ctx, key, 5, 900);
    const c = await ctx.users.confirmDeletion(u, await readJson(req, 16 * 1024));
    if (!c.ok) throw new ApiError(422, 'bad_credentials', c.message, { fields: { [c.field]: c.message } });
    await ctx.users.remove(u.id);
    await ctx.photos.removeAll(u.id); // файлы фото и визуализаций (всё под users/<id>/); строки таблиц ушли каскадом
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
  route('GET', '/api/projects', async (ctx, req) => {
    const u = await requireUser(ctx, req);
    const out = await ctx.projects.list(u); // заодно стирает проекты, пролежавшие в корзине свой срок
    await ctx.renders.gc(u.id, 3600);       // …а это — визуализации стёртых проектов
    return out;
  });
  route('POST', '/api/projects', async (ctx, req) => { const u = await writer(ctx, req); await createLimit(ctx, u); return ctx.projects.create(u, await readJson(req, BODY)); });
  /* корзина: удалённые проекты хранятся 30 суток и могут быть возвращены. Маршруты стоят раньше «/api/projects/:id». */
  route('GET', '/api/projects/trash', async (ctx, req) => ctx.projects.trash(await requireUser(ctx, req)));
  route('DELETE', '/api/projects/trash/:id', async (ctx, req, p) => {
    const u = await requireUser(ctx, req);
    const out = await ctx.projects.destroy(u, p.id);
    await ctx.renders.gc(u.id);
    return out;
  });
  route('POST', '/api/projects/:id/restore', async (ctx, req, p) => ctx.projects.restore(await writer(ctx, req), p.id));
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

  /* ---------- ссылка на проект для просмотра ----------
     Владелец включает и отключает ссылку; по ней проект открывается без входа и только для чтения (GET /api/shared/:token). */
  const shareUrl = (ctx, token) => `${ctx.baseUrl}/editor?share=${token}`;
  route('POST', '/api/projects/:id/share', async (ctx, req, p) => { const r = await ctx.projects.share(await writer(ctx, req), p.id); return { token: r.token, url: shareUrl(ctx, r.token) }; });
  route('DELETE', '/api/projects/:id/share', async (ctx, req, p) => ctx.projects.unshare(await requireUser(ctx, req), p.id));
  const sharedLimit = async (ctx, req) => { const lim = await ctx.limiter.hit(`share:ip:${ctx.limiter.tag(clientIp(req))}`, 600, 3600); if (!lim.ok) throw tooMany(lim.retryAfter); };
  route('GET', '/api/shared/:token', async (ctx, req, p) => { await sharedLimit(ctx, req); return ctx.projects.sharedGet(p.token); });
  route('GET', '/api/shared/:token/photos/:photo', async (ctx, req, p) => { await sharedLimit(ctx, req); return ctx.photos.ofProject(await ctx.projects.sharedRow(p.token), p.photo, { materialsOnly: true }); });

  /* ---------- фото пользователя (референсы и свои текстуры) ---------- */
  route('GET', '/api/photos', async (ctx, req) => ctx.photos.list(await requireUser(ctx, req)));
  route('PUT', '/api/photos/:id', async (ctx, req, p, q) => {
    const u = await writer(ctx, req);
    const lim = await ctx.limiter.hit(`photo:put:${u.id}`, 300, 3600);
    if (!lim.ok) throw tooMany(lim.retryAfter);
    return ctx.photos.put(u, p.id, await req.body(ctx.photos.MAX_BYTES), q);
  });
  route('GET', '/api/photos/:id', async (ctx, req, p) => ctx.photos.get(await requireUser(ctx, req), p.id));
  route('DELETE', '/api/photos/:id', async (ctx, req, p, q) => ctx.photos.remove(await requireUser(ctx, req), p.id, q.project ? String(q.project) : undefined));

  /* ---------- заявка менеджеру ----------
     Список товаров проекта с контактом уходит в раздел «Заявки» админ‑панели и письмом на CONTACT_EMAIL (если почта настроена). */
  route('POST', '/api/projects/:id/lead', async (ctx, req, p) => {
    const u = await requireUser(ctx, req);
    const pr = await ctx.projects.own(u, p.id);
    /* в лимит идут только принятые заявки: опечатка в телефоне не должна отнимать попытку */
    const key = `lead:${u.id}`;
    await attempt(ctx, key, 5, 3600);
    let lead;
    try { lead = await ctx.leads.create(u, pr, await readJson(req, 64 * 1024)); }
    catch (e) { await ctx.limiter.undo(key); throw e; }
    await ctx.audit(u.id, 'lead.create', 'lead', lead.id, { items: lead.items.length, total: lead.total, currency: lead.currency });
    const to = contactEmail(ctx);
    if (to) await ctx.mailer.sendQuiet('lead', { email: to, name: '' }, { lead, link: `${ctx.baseUrl}/admin#/leads` });
    /* пользователю — подтверждение: заявка принята, вот её состав. Только на подтверждённый адрес:
       иначе, зарегистрировавшись с чужой почтой, на неё можно слать письма сайта со своим текстом (название проекта) */
    if (u.emailVerified) await ctx.mailer.sendQuiet('lead_received', u, { lead, link: `${ctx.baseUrl}/account` });
    return { ok: true, id: lead.id, items: lead.items.length, total: lead.total, currency: lead.currency };
  });

  route('GET', '/api/leads', async (ctx, req) => ctx.leads.mine(await requireUser(ctx, req)));

  /* ---------- ИИ‑дизайнер ----------
     Три шага одной генерации — три запроса (см. server/core/designer.js). Каждый шаг — платное обращение к модели, поэтому:
     нужен вход и подтверждённая почта; лимиты проверяются строго (сбой лимитера — отказ, а не пропуск);
     шаг «расстановка» принимается только с пропуском, который выдаёт шаг «концепция». */
  const DAY = 86400;
  const aiLimit = (message, retryAfter) => new ApiError(429, 'ai_limit', message, { retryAfter }, { 'Retry-After': String(retryAfter || 60) });
  const aiCount = async (ctx, fn, key, limit, win, message) => {
    let c;
    try { c = fn === 'take' ? await ctx.limiter.take(key, limit, win) : await ctx.limiter.peek(key, limit, win, { strict: true }); }
    catch { throw new ApiError(503, 'ai_limits', 'Не удалось проверить лимиты. Попробуйте позже'); }
    if (!c.ok) throw aiLimit(message, c.retryAfter);
    return c;
  };
  /* Общий счётчик обращений к модели: суточный (атомарно) и, если задан AI_MONTHLY_CALLS, за 30 суток — по журналу обращений.
     Месячный предел — страховка от счёта провайдера, а не точный учёт: считается с небольшим запаздыванием. */
  const AI_BUSY_TEXT = { monthly: 'ИИ‑дизайнер временно недоступен: исчерпан месячный лимит. Напишите нам, если он нужен срочно', daily: 'ИИ‑дизайнер сегодня перегружен. Попробуйте завтра' };
  const aiGlobal = async (ctx, text = AI_BUSY_TEXT) => {
    const lim = aiLimits(ctx);
    if (lim.monthly) {
      let n;
      try { n = Number((await ctx.db.get("SELECT CAST(COUNT(*) AS INTEGER) AS c FROM audit_log WHERE entity = 'ai' AND at > ?", [new Date(Date.now() - 30 * DAY * 1000).toISOString()])).c); }
      catch { throw new ApiError(503, 'ai_limits', 'Не удалось проверить лимиты. Попробуйте позже'); }
      if (n >= lim.monthly) throw aiLimit(text.monthly, DAY);
    }
    await aiCount(ctx, 'take', 'ai:global', lim.calls, DAY, text.daily);
  };
  const aiUser = async (ctx, req) => {
    if (!ctx.ai.enabled) throw new ApiError(503, 'ai_off', 'ИИ‑дизайнер пока не подключён');
    const u = await requireUser(ctx, req);
    /* только подтверждённая почта; пока отправка писем не настроена, подтвердить её нельзя — проверка не действует */
    if (ctx.mailer.enabled && !u.emailVerified && u.role !== 'admin') throw new ApiError(403, 'email_unverified', 'Подтвердите почту, чтобы пользоваться ИИ‑дизайнером');
    return u;
  };
  const AI_FAIL = {
    ai_off: [503, 'ИИ‑дизайнер пока не подключён'], ai_timeout: [504, 'Модель не успела ответить. Попробуйте ещё раз'], ai_network: [502, 'Нет связи с моделью. Попробуйте ещё раз'],
    ai_auth: [502, 'ИИ‑дизайнер временно недоступен'], ai_busy: [503, 'Модель сейчас перегружена. Попробуйте через минуту'], ai_request: [502, 'ИИ‑дизайнер временно недоступен'],
    ai_refused: [422, 'Модель отказалась обрабатывать запрос. Измените пожелания или фото'], ai_truncated: [502, 'Ответ модели оборвался. Попробуйте ещё раз'], ai_bad_answer: [502, 'Модель вернула непонятный ответ. Попробуйте ещё раз'],
  };
  /* Один шаг: вызов, запись в журнал (без текстов и фото — только размеры запроса, расход и время), перевод ошибок модели в ответы API */
  const aiStep = async (ctx, u, step, entityId, extra, fn, fails = AI_FAIL) => {
    const t0 = Date.now();
    try {
      const res = await fn();
      await ctx.audit(u.id, 'ai.' + step, 'ai', entityId, { ...extra, ...(res.stats || {}), in: res.usage.in, out: res.usage.out, ...(res.usage.cacheRead ? { cr: res.usage.cacheRead } : {}), ...(res.usage.cacheWrite ? { cw: res.usage.cacheWrite } : {}), ms: res.ms, model: res.model }).catch((e) => console.error('audit:', e.message));
      return res;
    } catch (e) {
      const code = e instanceof AiError ? e.code : e instanceof ApiError ? e.code : 'internal';
      await ctx.audit(u.id, 'ai.' + step, 'ai', entityId, { ...extra, error: code, ms: Date.now() - t0 }).catch(() => {});
      if (!(e instanceof AiError)) throw e;
      console.error(`ai ${step}: ${e.code}: ${e.message}`); // подробности провайдера — только в журнал сервера
      const [status, message] = fails[e.code] || fails.other || [502, 'ИИ‑дизайнер временно недоступен'];
      throw new ApiError(status, e.code, message);
    }
  };
  route('POST', '/api/ai/taste', async (ctx, req) => {
    const u = await aiUser(ctx, req);
    const r = designer.readTasteReq(await readJson(req, designer.LIM.tasteBody));
    const lim = aiLimits(ctx);
    if (u.role !== 'admin') await aiCount(ctx, 'take', `ai:taste:${u.id}`, lim.runs * 3, DAY, 'Дневной лимит ИИ‑дизайнера исчерпан. Попробуйте завтра');
    await aiGlobal(ctx);
    const res = await aiStep(ctx, u, 'taste', null, { photos: r.photos.length, text: r.text.length }, () => designer.taste(ctx.ai, r));
    return { profile: res.profile, seal: ctx.aiSeals.make('taste:' + u.id, res.profile) };
  });
  route('POST', '/api/ai/concept', async (ctx, req) => {
    const u = await aiUser(ctx, req);
    const r = designer.readConceptReq(await readJson(req, designer.LIM.body));
    /* профиль вкуса принимается только с печатью шага «вкус» этого же пользователя; иначе подбор идёт без профиля */
    if (!ctx.aiSeals.check('taste:' + u.id, r.taste, r.tasteSeal)) r.taste = designer.emptyProfile();
    const prepared = await designer.prepareConcept(ctx.catalog, r); // нет подходящих товаров — отказ до счётчиков и до модели
    const lim = aiLimits(ctx); const free = u.role === 'admin';
    const kRun = `ai:run:${u.id}`;
    /* Запуск резервируется до обращения к модели (параллельные запросы не обходят лимит) и возвращается, если концепция не удалась:
       сбой модели не съедает дневной лимит. Попытки (ai:try) считаются все — это предел для неудачных. */
    let run = null;
    if (!free) {
      await aiCount(ctx, 'peek', kRun, lim.runs, DAY, `Дневной лимит генераций исчерпан (${lim.runs} в сутки). Попробуйте завтра`);
      await aiCount(ctx, 'take', `ai:try:${u.id}`, lim.runs * 4, DAY, 'Слишком много попыток генерации. Попробуйте завтра');
      try { run = await aiCount(ctx, 'take', kRun, lim.runs, DAY, `Дневной лимит генераций исчерпан (${lim.runs} в сутки). Попробуйте завтра`); }
      catch (e) { if (e.code === 'ai_limit') await ctx.limiter.undo(kRun); throw e; }
    }
    const { pass, runId } = ctx.aiPasses.issue(u.id);
    let res;
    try {
      await aiGlobal(ctx);
      res = await aiStep(ctx, u, 'concept', runId, { mode: r.mode }, () => designer.concept(ctx.ai, ctx.catalog, r, prepared));
    } catch (e) { if (run) await ctx.limiter.undo(kRun); throw e; }
    const concepts = res.concepts.map(c => ({ ...c, seal: ctx.aiSeals.make('concept:' + runId, designer.conceptSealed(c)) }));
    return { runId, pass, concepts, groups: res.groups, products: res.products, runsLeft: run ? Math.max(0, lim.runs - run.count) : null };
  });
  route('POST', '/api/ai/layout', async (ctx, req) => {
    const u = await aiUser(ctx, req);
    const r = designer.readLayoutReq(await readJson(req, designer.LIM.body));
    const p = ctx.aiPasses.check(r.pass, u.id);
    if (!p || !ctx.aiSeals.check('concept:' + p.runId, designer.conceptSealed(r.concept), r.concept.seal)) throw new ApiError(403, 'ai_pass', 'Сеанс генерации устарел. Запустите генерацию заново');
    await aiCount(ctx, 'take', `ai:pass:${p.runId}`, designer.LIM.layoutCallsPerPass, designer.LIM.passTtlSec, 'Слишком много попыток расстановки. Запустите генерацию заново');
    await aiGlobal(ctx);
    const res = await aiStep(ctx, u, 'layout', p.runId, { variant: r.variant, retry: r.retry }, () => designer.layout(ctx.ai, r));
    return { placements: res.placements };
  });
  /* Сколько генераций осталось сегодня — мастер показывает это до запуска */
  route('GET', '/api/ai/quota', async (ctx, req) => {
    const u = await aiUser(ctx, req); const lim = aiLimits(ctx);
    if (u.role === 'admin') return { runs: lim.runs, left: null };
    const c = await ctx.limiter.peek(`ai:run:${u.id}`, lim.runs, DAY);
    return { runs: lim.runs, left: Math.max(0, lim.runs - (c.count || 0)), retryAfter: c.ok ? 0 : c.retryAfter };
  });
  /* Возврат генерации, от которой пользователь ничего не получил: концепция построена, но ни один вариант расстановки не собрался.
     Сервер не видит, что произошло в браузере, поэтому возврат ограничен: один на генерацию и не больше трёх в сутки. */
  route('POST', '/api/ai/refund', async (ctx, req) => {
    const u = await aiUser(ctx, req);
    const b = await readJson(req, 16 * 1024);
    const p = ctx.aiPasses.check(b.pass, u.id);
    if (!p) throw new ApiError(403, 'ai_pass', 'Сеанс генерации устарел');
    if (u.role === 'admin') return { ok: true, refunded: false };
    let once, daily;
    try {
      once = await ctx.limiter.take(`ai:refund:run:${p.runId}`, 1, designer.LIM.passTtlSec);
      if (!once.ok) return { ok: true, refunded: false };
      daily = await ctx.limiter.take(`ai:refund:${u.id}`, 3, DAY);
    } catch { return { ok: true, refunded: false }; }
    if (!daily.ok) return { ok: true, refunded: false };
    /* возвращённой генерацией больше нельзя пользоваться: счётчик её пропуска выставляется за предел */
    try {
      const kPass = `ai:pass:${p.runId}`;
      await ctx.limiter.take(kPass, designer.LIM.layoutCallsPerPass, designer.LIM.passTtlSec);
      await ctx.db.run('UPDATE rate_limits SET count = ? WHERE key = ?', [designer.LIM.layoutCallsPerPass + 1000, kPass]);
    } catch { return { ok: true, refunded: false }; }
    await ctx.limiter.undo(`ai:run:${u.id}`);
    await ctx.audit(u.id, 'ai.refund', 'ai_run', p.runId).catch(() => {});
    return { ok: true, refunded: true };
  });

  /* ---------- визуализация комнаты ----------
     Кадр из 3D‑вида → фотореалистичная картинка (server/core/renders.js). Каждая картинка — платное обращение к модели, поэтому правила
     те же, что у ИИ‑дизайнера: вход, подтверждённая почта, строгие лимиты; попытка возвращается, если модель картинку не отдала.
     Картинка принадлежит проекту аккаунта и читается только через API: владельцем, поддержкой и гостем по ссылке на проект. */
  const RENDER_FAIL = {
    ai_off: [503, 'Визуализация пока не подключена'], ai_timeout: [504, 'Модель не успела нарисовать картинку. Попробуйте ещё раз'], ai_network: [502, 'Нет связи с моделью. Попробуйте ещё раз'],
    ai_busy: [503, 'Модель сейчас перегружена. Попробуйте через минуту'], ai_refused: [422, 'Модель отказалась рисовать этот кадр. Попробуйте другой ракурс'],
    ai_bad_answer: [502, 'Модель вернула непонятный ответ. Попробуйте ещё раз'], other: [502, 'Визуализация временно недоступна'],
  };
  const RENDER_BUSY_TEXT = { monthly: 'Визуализация временно недоступна: исчерпан месячный лимит. Напишите нам, если она нужна срочно', daily: 'Сегодня визуализация перегружена. Попробуйте завтра' };
  const renderQuota = async (ctx, u) => {
    const lim = renderLimits(ctx);
    if (u.role === 'admin') return { limit: lim.daily, left: null };
    const c = await ctx.limiter.peek(`ai:render:${u.id}`, lim.daily, DAY);
    return { limit: lim.daily, left: Math.max(0, lim.daily - (c.count || 0)) };
  };
  const renderList = async (ctx, projectId, extra = {}) => ({ renders: await ctx.renders.list(projectId), limit: rendersCore.LIM.perProject, ...extra });
  route('GET', '/api/projects/:id/renders', async (ctx, req, p) => {
    const u = await requireUser(ctx, req);
    const pr = await ctx.projects.ownMeta(u, p.id);
    return renderList(ctx, pr.id, { enabled: ctx.imageAi.enabled, mock: ctx.imageAi.mock, refs: renderLimits(ctx).refs, daily: await renderQuota(ctx, u) });
  });
  route('POST', '/api/projects/:id/renders', async (ctx, req, p) => {
    if (!ctx.imageAi.enabled) throw new ApiError(503, 'ai_off', 'Визуализация пока не подключена');
    const u = await requireUser(ctx, req);
    if (ctx.mailer.enabled && !u.emailVerified && u.role !== 'admin') throw new ApiError(403, 'email_unverified', 'Подтвердите почту, чтобы создавать визуализации');
    const pr = await ctx.projects.ownMeta(u, p.id);
    const r = rendersCore.readReq(await readJson(req, rendersCore.LIM.body));
    const lim = renderLimits(ctx);
    /* фото товаров принимаются только для опубликованных товаров каталога: подпись к фото берётся из каталога, а не от клиента */
    const cards = r.refs.length && lim.refs ? new Map((await ctx.catalog.publicByIds(r.refs.map((x) => x.productId))).map((c) => [c.id, c])) : new Map();
    const refs = r.refs.filter((x) => cards.has(x.productId)).slice(0, lim.refs);
    /* образец стиля — готовая визуализация этого же проекта; новый ракурс наследует и её освещение */
    const anchor = r.anchorId ? await ctx.renders.source(pr.id, r.anchorId) : null;
    const mood = anchor ? anchor.mood : r.mood;
    await ctx.renders.gc(u.id);
    if ((await ctx.renders.count(pr.id)) >= rendersCore.LIM.perProject) throw new ApiError(422, 'limit', `В проекте уже ${rendersCore.LIM.perProject} визуализаций. Удалите ненужные, чтобы создать новую`);
    /* Попытка резервируется до обращения к модели (параллельные запросы не обходят лимит) и возвращается, если картинка не получена.
       Неудачные попытки считаются отдельно (ai:rtry) — это предел для них. */
    const free = u.role === 'admin', kDay = `ai:render:${u.id}`, dayText = `Дневной лимит визуализаций исчерпан (${lim.daily} в сутки). Попробуйте завтра`;
    let take = null;
    if (!free) {
      await aiCount(ctx, 'peek', kDay, lim.daily, DAY, dayText);
      await aiCount(ctx, 'take', `ai:rtry:${u.id}`, lim.daily * 4, DAY, 'Слишком много попыток визуализации. Попробуйте завтра');
      try { take = await aiCount(ctx, 'take', kDay, lim.daily, DAY, dayText); }
      catch (e) { if (e.code === 'ai_limit') await ctx.limiter.undo(kDay); throw e; }
    }
    let saved;
    try {
      await aiGlobal(ctx, RENDER_BUSY_TEXT);
      const prompt = rendersCore.buildPrompt({ scene: r.scene, mood, products: refs.map((x) => cards.get(x.productId)), anchor: !!anchor });
      const images = [r.frame, ...(anchor ? [{ mime: anchor.mime, data: anchor.data }] : []), ...refs.map((x) => ({ mime: x.mime, data: x.data }))];
      const res = await aiStep(ctx, u, 'render', pr.id, { refs: refs.length, anchor: !!anchor, mood }, () => ctx.imageAi.generate({ ...prompt, images, aspect: r.aspect }), RENDER_FAIL);
      saved = await ctx.renders.save(u, pr.id, res.image, { label: r.label, mood, anchor: anchor ? anchor.id : null, aspect: r.aspect, model: res.model, size: ctx.imageAi.size });
    } catch (e) { if (take) await ctx.limiter.undo(kDay); throw e; }
    return { render: saved, daily: { limit: lim.daily, left: take ? Math.max(0, lim.daily - take.count) : null } };
  });
  route('GET', '/api/projects/:id/renders/:rid', async (ctx, req, p) => ctx.renders.read((await ctx.projects.ownMeta(await requireUser(ctx, req), p.id)).id, p.rid));
  route('DELETE', '/api/projects/:id/renders/:rid', async (ctx, req, p) => ctx.renders.remove((await ctx.projects.ownMeta(await requireUser(ctx, req), p.id)).id, p.rid));
  /* гость по ссылке владельца: визуализации видны вместе с проектом, только для просмотра */
  route('GET', '/api/shared/:token/renders', async (ctx, req, p) => { await sharedLimit(ctx, req); return renderList(ctx, (await ctx.projects.sharedRow(p.token)).id); });
  route('GET', '/api/shared/:token/renders/:rid', async (ctx, req, p) => { await sharedLimit(ctx, req); return ctx.renders.read((await ctx.projects.sharedRow(p.token)).id, p.rid); });

  // публичный каталог
  route('GET', '/api/catalog/types', async () => ({ cats: T.CATS, dimNames: T.DIMN, types: T.TYPES.map(t => ({ id: t.id, name: t.name, cats: t.cats, mount: t.mount, forms: t.forms.map(f => ({ id: f.id, name: f.name, fp: f.fp, dims: T.formDimKeys(f), typical: f.typical })) })) }));
  /* Каталог отдаётся порциями (limit до 2000, offset); images=1 — только товары с фото.
     Ответ одинаков для всех, поэтому кэшируется: CDN держит его минуту, браузер сверяет по ETag и получает 304 без тела. */
  route('GET', '/api/catalog/products', async (ctx, req, p, q) => {
    const withImages = q.images === '1' || q.images === 'true';
    const etag = `W/"${await ctx.catalog.publicVersion()}-${parseInt(q.limit) || 0}-${parseInt(q.offset) || 0}-${withImages ? 1 : 0}"`;
    const headers = { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300', ETag: etag };
    /* сравнение «слабое»: пометка W/ не важна, «*» подходит всегда */
    const opaque = (t) => t.trim().replace(/^W\//, '');
    if (String(req.header('if-none-match') || '').split(',').some((t) => t.trim() === '*' || opaque(t) === opaque(etag))) return new Reply(304, headers, null);
    return new Reply(200, headers, await ctx.catalog.publicPage({ ...q, images: withImages }));
  });

  // админ: товары
  route('GET', '/api/admin/stats', admin(async (ctx) => ({ ...(await ctx.catalog.stats()), users: await ctx.users.total(), leads: await ctx.leads.fresh() })));

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
  route('GET', '/api/admin/projects/:id/photos/:photo', admin(async (ctx, u, req, p) => {
    const row = await ctx.db.get('SELECT * FROM projects WHERE id=? AND deleted_at IS NULL', [String(p.id)]);
    if (!row) throw new ApiError(404, 'not_found', 'Проект не найден');
    return ctx.photos.ofProject(row, p.photo, { materialsOnly: false });
  }));
  /* визуализации просматриваемого проекта — поддержке, только чтение */
  const adminProjectId = async (ctx, id) => {
    const row = await ctx.db.get('SELECT id FROM projects WHERE id=? AND deleted_at IS NULL', [String(id)]);
    if (!row) throw new ApiError(404, 'not_found', 'Проект не найден');
    return row.id;
  };
  route('GET', '/api/admin/projects/:id/renders', admin(async (ctx, u, req, p) => renderList(ctx, await adminProjectId(ctx, p.id))));
  route('GET', '/api/admin/projects/:id/renders/:rid', admin(async (ctx, u, req, p) => ctx.renders.read(await adminProjectId(ctx, p.id), p.rid)));
  route('GET', '/api/admin/leads', admin((ctx, u, req, p, q) => ctx.leads.list(q)));
  route('POST', '/api/admin/leads/:id/status', admin(async (ctx, u, req, p) => {
    const lead = await ctx.leads.setStatus(p.id, (await readJson(req, 4096)).status);
    await ctx.audit(u.id, 'lead.' + lead.status, 'lead', lead.id);
    return lead;
  }));
  route('POST', '/api/admin/leads/:id/note', admin(async (ctx, u, req, p) => ctx.leads.setNote(p.id, (await readJson(req, 16 * 1024)).note)));
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
  // фото
  route('POST', '/api/admin/products/:id/images', admin(async (ctx, u, req, p) => ctx.catalog.attachImage(u, p.id, await req.body(LIMITS.imageBytes))));
  route('POST', '/api/admin/products/:id/images/commit', admin(async (ctx, u, req, p) => {
    const { url } = await readJson(req);
    if (!ctx.storage.owns(url, `products/${p.id}/`)) throw new ApiError(400, 'bad_url', 'Файл не из хранилища этого товара');
    return ctx.catalog.attachImage(u, p.id, await ctx.storage.read(url), url);
  }));
  route('DELETE', '/api/admin/products/:id/images/:img', admin((ctx, u, req, p) => ctx.catalog.deleteImage(u, p.id, p.img)));
  route('POST', '/api/admin/products/:id/images/:img/move', admin(async (ctx, u, req, p) => ctx.catalog.moveImage(u, p.id, p.img, (await readJson(req)).dir)));
  /* Демо удаляется целиком; набор каталога, лежащий в проекте (public/catalog-pack), сразу записывается заново.
     Так кнопка убирает сгенерированные демо‑товары, а чтобы убрать и набор — сначала удалите его папку из проекта. */
  route('POST', '/api/admin/demo/purge', admin(async (ctx, u) => {
    const deleted = await ctx.catalog.purgeDemo(u);
    const pack = await syncPack(ctx, { force: true }).catch((e) => { console.error('Набор каталога не записан в базу:', e.message); return null; });
    return { deleted, restored: pack ? pack.imported : 0 };
  }));
  /* сводка расходов ИИ‑дизайнера за последние days суток: токены, ошибки и (если заданы цены) стоимость */
  route('GET', '/api/admin/ai/usage', admin((ctx, u, req, p, q) => ctx.aiUsage.summary(q.days)));
  /* entity=ai — только обращения к ИИ‑дизайнеру (их много, в общем списке они вытесняют остальное); entity=other — всё, кроме них */
  route('GET', '/api/admin/audit', admin(async (ctx, u, req, p, q) => {
    const where = q.entity === 'ai' ? "WHERE a.entity = 'ai'" : q.entity === 'other' ? "WHERE a.entity <> 'ai'" : '';
    return { items: await ctx.db.all(`SELECT a.*, u.email FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ${where} ORDER BY a.at DESC, a.id DESC LIMIT ?`, [Math.max(1, Math.min(500, Math.floor(Number(q.limit)) || 100))]) };
  }));

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

  /* ---------- обработчик ---------- */
  async function handle(req) {
    try {
      const matching = routes.filter(r => r.re.test(req.pathname));
      if (!matching.length) throw new ApiError(404, 'not_found', 'Нет такого метода API');
      const r = matching.find(x => x.method === req.method);
      if (!r) throw new ApiError(405, 'method_not_allowed', 'Метод не поддерживается');
      const ctx = await init();
      const m = r.re.exec(req.pathname); const params = {};
      try { r.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1])); }
      catch { throw new ApiError(400, 'bad_path', 'Некорректный адрес запроса'); } // «%» без кода символа
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
