'use strict';
/* Пользователи, роли, сессии. Пароли — scrypt (асинхронно: расчёт не блокирует остальные запросы).
   Токен сессии — 32 случайных байта, заголовок Authorization: Bearer <token>. В базе лежит не сам токен,
   а его SHA‑256 с пометкой «h:» — копия базы не даёт войти в чужие сессии.
   Роли: admin — всё; company — свои товары (заложено); client — редактор (заложено). */
const crypto = require('node:crypto');

const SESSION_DAYS = 30;
let ADMIN_SESSION_DAYS = 7; // сессия администратора короче: её кража стоит дороже
const now = () => new Date().toISOString();
const SCRYPT = { N: 16384, r: 8, p: 1 };
const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 32, SCRYPT, (e, key) => (e ? rej(e) : res(key))));

function configure({ adminSessionDays } = {}) {
  const n = Math.floor(Number(adminSessionDays));
  if (Number.isFinite(n) && n >= 1 && n <= 365) ADMIN_SESSION_DAYS = n;
}

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(pw), salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = await scrypt(String(pw), Buffer.from(saltHex, 'hex'));
  const exp = Buffer.from(keyHex, 'hex');
  return exp.length === key.length && crypto.timingSafeEqual(exp, key);
}
/* Пароль перед хешированием и перед проверкой приводится к одной форме Юникода (NFC):
   «й» и «ё», набранные составными символами, — тот же пароль. */
const normPassword = (s) => String(s == null ? '' : s).normalize('NFC');

/* Аккаунт без пароля (создан через Google или Яндекс): значение, которое не пройдёт verifyPassword ни с каким паролем */
const NO_PASSWORD = '!';
const hasPassword = (stored) => String(stored || '').startsWith('scrypt$');
/* Для неизвестной почты считаем scrypt по фиктивному хешу — время ответа не выдаёт, есть ли аккаунт */
let dummyHash = null;
const dummy = () => dummyHash || (dummyHash = hashPassword(crypto.randomBytes(16).toString('hex')));

/* Ключ сессии в базе: «h:» + SHA‑256 токена */
const sessionKey = (token) => 'h:' + crypto.createHash('sha256').update(String(token)).digest('hex');
/* Строка поиска пользователя без учёта регистра (SQLite не понижает регистр кириллицы) */
const searchText = (name, email) => `${name || ''} ${email || ''}`.toLowerCase().replace(/ё/g, 'е').trim();

/* terms — { acceptedAt, version } для клиентов; у администратора согласия нет.
   password: null — аккаунт без пароля; verified — почта подтверждена провайдером. */
async function createUser(db, { email, password, role, companyId = null, name = '', terms = null, marketing = false, verified = false }) {
  const id = crypto.randomUUID();
  const em = email.toLowerCase().trim();
  await db.run('INSERT INTO users (id,email,password_hash,role,company_id,name,created_at,terms_accepted_at,terms_version,marketing_opt_in,updated_at,email_verified_at,search) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, em, password == null ? NO_PASSWORD : await hashPassword(normPassword(password)), role, companyId, name, now(), terms ? terms.acceptedAt : null, terms ? terms.version : '', marketing ? 1 : 0, now(), verified ? now() : null, searchText(name, em)]);
  return id;
}

/* Сессия без проверки пароля — после регистрации и после успешного входа */
async function createSession(db, u) {
  const token = crypto.randomBytes(32).toString('hex');
  const days = u.role === 'admin' ? ADMIN_SESSION_DAYS : SESSION_DAYS;
  const exp = new Date(Date.now() + days * 864e5).toISOString();
  await db.run('INSERT INTO sessions (token,user_id,created_at,expires_at) VALUES (?,?,?,?)', [sessionKey(token), u.id, now(), exp]);
  await db.run('UPDATE users SET last_login_at=? WHERE id=?', [now(), u.id]);
  if (Math.random() < 0.02) { // попутная очистка: фоновых задач в проекте нет
    try {
      await db.run('DELETE FROM sessions WHERE expires_at < ?', [now()]);
      await db.run('DELETE FROM auth_tokens WHERE expires_at < ?', [new Date(Date.now() - 7 * 864e5).toISOString()]);
      /* журнал обращений к модели нужен сводке расходов не дольше 90 суток; храним полгода */
      await db.run("DELETE FROM audit_log WHERE entity = 'ai' AND at < ?", [new Date(Date.now() - 180 * 864e5).toISOString()]);
    } catch {}
  }
  return { token, user: publicUser(u), expiresAt: exp };
}

/* → сессия | { blocked: true } (пароль верный, аккаунт заблокирован) | null (почта или пароль неверны) */
async function login(db, email, password) {
  const pw = normPassword(password);
  if (pw.length > 1024) return null; // не гоняем scrypt по огромным строкам
  const u = await db.get('SELECT * FROM users WHERE email = ?', [String(email || '').toLowerCase().trim()]);
  if (!u || !hasPassword(u.password_hash)) { await verifyPassword(pw, await dummy()); return null; }
  if (!(await verifyPassword(pw, u.password_hash))) return null;
  if (Number(u.disabled)) return { blocked: true };
  return createSession(db, u);
}
async function logout(db, token) { await db.run('DELETE FROM sessions WHERE token = ?', [sessionKey(token)]); }

async function userFromToken(db, authHeader) {
  const m = /^Bearer\s+([a-f0-9]{64})$/i.exec(authHeader || '');
  if (!m) return null;
  const raw = m[1].toLowerCase(), key = sessionKey(raw);
  const find = (t) => db.get('SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', [t]);
  let row = await find(key);
  if (!row) {
    /* Сессия, записанная до хеширования (в том числе прежней версией кода, ещё работавшей во время выкладки):
       находится по открытому токену и тут же переводится в новый вид. Хеш из базы так предъявить нельзя — он не проходит формат токена. */
    row = await find(raw);
    if (row) { try { await db.run('UPDATE sessions SET token=? WHERE token=?', [key, raw]); } catch {} }
  }
  if (!row || Number(row.disabled) || row.expires_at < now()) return null;
  const u = { ...publicUser(row) };
  /* ключ сессии нужен серверу («завершить остальные сеансы»), но не должен уходить клиенту вместе с пользователем */
  Object.defineProperty(u, 'sessionKey', { value: key, enumerable: false });
  return u;
}
function publicUser(u) { return { id: u.id, email: u.email, role: u.role, companyId: u.company_id, name: u.name, emailVerified: !!u.email_verified_at, hasPassword: hasPassword(u.password_hash) }; }

/* Сессии, созданные до хеширования токенов, переводятся на новый вид один раз. Безопасно при параллельном холодном старте:
   строка обновляется по прежнему значению, второй запуск её уже не найдёт. */
async function migrateSessions(db, limit = 1000000) {
  /* Postgres считает SHA‑256 сам — одна команда на все строки; SQLite такой функции не имеет, там строки переводятся по одной */
  if (db.dialect === 'postgres') {
    try { const r = await db.run("UPDATE sessions SET token = 'h:' || encode(sha256(convert_to(token, 'UTF8')), 'hex') WHERE token NOT LIKE 'h:%'"); return { done: r.changes || 0, left: 0 }; }
    catch (e) { console.error('migrateSessions:', e.message); }
  }
  const rows = await db.all("SELECT token FROM sessions WHERE token NOT LIKE 'h:%' LIMIT ?", [limit + 1]);
  for (const r of rows.slice(0, limit)) {
    try { await db.run('UPDATE sessions SET token=? WHERE token=?', [sessionKey(r.token), r.token]); }
    catch (e) { if (!/unique|duplicate|constraint/i.test(e.message)) throw e; }
  }
  return { done: Math.min(rows.length, limit), left: Math.max(0, rows.length - limit) };
}
/* Строка поиска у пользователей, созданных до миграции v7 */
async function backfillUserSearch(db, limit = 1000000) {
  const rows = await db.all("SELECT id, name, email FROM users WHERE search = '' LIMIT ?", [limit + 1]);
  for (const r of rows.slice(0, limit)) await db.run('UPDATE users SET search=? WHERE id=?', [searchText(r.name, r.email), r.id]);
  return { done: Math.min(rows.length, limit), left: Math.max(0, rows.length - limit) };
}

/* Права — одна точка правды для всех ролей. API сейчас открыт только admin,
   но проверки уже учитывают компанию, чтобы кабинет компании подключился без переделки. */
function can(user, action, product) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'company') {
    const own = !product || product.owner_company_id === user.companyId;
    switch (action) {
      case 'product.create': return true;
      case 'product.read': case 'product.update': case 'product.delete': case 'product.model': case 'product.images':
        return own && product.status !== 'archived';
      case 'product.submit': return own && ['draft', 'rejected'].includes(product.status);
      case 'product.publish': case 'product.reject': return false; // публикует только модерация (admin)
      default: return false;
    }
  }
  return false; // client: только публичный каталог
}

/* Проекты редактора: только владелец (администратор чужие проекты через этот API не видит) */
function canProject(user, action, project) {
  if (!user) return false;
  if (action === 'project.create' || action === 'project.list') return true;
  return !!project && project.user_id === user.id;
}

module.exports = { configure, hashPassword, verifyPassword, normPassword, hasPassword, NO_PASSWORD, sessionKey, searchText, createUser, createSession, login, logout, userFromToken,
  migrateSessions, backfillUserSearch, can, canProject, publicUser };
