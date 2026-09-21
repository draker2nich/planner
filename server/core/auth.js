'use strict';
/* Пользователи, роли, сессии. Пароли — scrypt. Токен сессии — 32 случайных байта, заголовок Authorization: Bearer <token>.
   Роли: admin — всё; company — свои товары (заложено); client — редактор (заложено). */
const crypto = require('node:crypto');

const SESSION_DAYS = 30;
const now = () => new Date().toISOString();

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 32, { N: 16384, r: 8, p: 1 });
  const exp = Buffer.from(keyHex, 'hex');
  return exp.length === key.length && crypto.timingSafeEqual(exp, key);
}

async function createUser(db, { email, password, role, companyId = null, name = '' }) {
  const id = crypto.randomUUID();
  await db.run('INSERT INTO users (id,email,password_hash,role,company_id,name,created_at) VALUES (?,?,?,?,?,?,?)',
    [id, email.toLowerCase().trim(), hashPassword(password), role, companyId, name, now()]);
  return id;
}

async function login(db, email, password) {
  const u = await db.get('SELECT * FROM users WHERE email = ?', [String(email || '').toLowerCase().trim()]);
  if (!u || Number(u.disabled) || !verifyPassword(String(password || ''), u.password_hash)) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await db.run('INSERT INTO sessions (token,user_id,created_at,expires_at) VALUES (?,?,?,?)', [token, u.id, now(), exp]);
  return { token, user: publicUser(u), expiresAt: exp };
}
async function logout(db, token) { await db.run('DELETE FROM sessions WHERE token = ?', [token]); }

async function userFromToken(db, authHeader) {
  const m = /^Bearer\s+([a-f0-9]{64})$/i.exec(authHeader || '');
  if (!m) return null;
  const row = await db.get('SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', [m[1]]);
  if (!row || Number(row.disabled) || row.expires_at < now()) return null;
  return { ...publicUser(row), token: m[1] };
}
function publicUser(u) { return { id: u.id, email: u.email, role: u.role, companyId: u.company_id, name: u.name }; }

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

module.exports = { hashPassword, verifyPassword, createUser, login, logout, userFromToken, can };
