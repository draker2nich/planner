'use strict';
/* Пользователи: страница аккаунта (самому пользователю) и раздел «Пользователи» админ‑панели. */
const auth = require('./auth.js');
const { ApiError } = require('./catalog.js');
const V = require('../../public/shared/validation.js');

const PAGE = 50;
const now = () => new Date().toISOString();
const COUNT = 'CAST(COUNT(*) AS INTEGER)';
const likeEsc = (s) => String(s).replace(/[\\%_]/g, (c) => '\\' + c);

function makeUsers(db) {
  const providersOf = async (userId) => (await db.all('SELECT provider FROM user_identities WHERE user_id=? ORDER BY provider', [userId])).map((r) => r.provider);
  const sessionsOf = async (userId) => Number((await db.get(`SELECT ${COUNT} AS c FROM sessions WHERE user_id=? AND expires_at>?`, [userId, now()])).c);
  const adminDto = (u) => ({
    id: u.id, email: u.email, name: u.name, role: u.role,
    disabled: !!Number(u.disabled), disabledReason: u.disabled_reason || '',
    emailVerified: !!u.email_verified_at, hasPassword: auth.hasPassword(u.password_hash),
    createdAt: u.created_at, lastLoginAt: u.last_login_at || null,
    termsAcceptedAt: u.terms_accepted_at || null, termsVersion: u.terms_version || '', marketing: !!Number(u.marketing_opt_in),
    projects: u.projects == null ? undefined : Number(u.projects),
  });
  async function target(id) {
    const u = await db.get('SELECT * FROM users WHERE id=?', [String(id)]);
    if (!u) throw new ApiError(404, 'not_found', 'Пользователь не найден');
    return u;
  }

  return {
    /* ---------- страница аккаунта ---------- */
    async account(user) {
      const u = await db.get('SELECT * FROM users WHERE id=?', [user.id]);
      return {
        user: auth.publicUser(u), createdAt: u.created_at,
        providers: await providersOf(u.id), sessions: await sessionsOf(u.id),
        projects: Number((await db.get(`SELECT ${COUNT} AS c FROM projects WHERE user_id=? AND deleted_at IS NULL`, [u.id])).c),
      };
    },
    async rename(user, body) {
      const err = V.validateName(body.name);
      if (err) throw new ApiError(422, 'validation', err, { fields: { name: err } });
      await db.run('UPDATE users SET name=?, updated_at=? WHERE id=?', [V.normName(body.name), now(), user.id]);
      return { user: auth.publicUser(await db.get('SELECT * FROM users WHERE id=?', [user.id])) };
    },
    async revokeOtherSessions(user) {
      const r = await db.run('DELETE FROM sessions WHERE user_id=? AND token<>?', [user.id, user.token]);
      return { ok: true, revoked: r.changes };
    },
    /* Проверка подтверждения перед удалением: пароль, а у аккаунта без пароля — собственная почта */
    async confirmDeletion(user, body) {
      const u = await db.get('SELECT * FROM users WHERE id=?', [user.id]);
      if (auth.hasPassword(u.password_hash)) {
        const pw = String(body.password || '');
        if (!pw || pw.length > 1024 || !auth.verifyPassword(pw, u.password_hash)) return { ok: false, field: 'password', message: 'Неверный пароль' };
      } else if (V.normEmail(body.confirmEmail) !== u.email) return { ok: false, field: 'confirmEmail', message: 'Введите почту этого аккаунта' };
      return { ok: true, row: u };
    },
    /* Сессии, проекты, токены и связи с провайдерами удаляются каскадом */
    async remove(userId) { await db.run('DELETE FROM users WHERE id=?', [userId]); },

    /* ---------- админ‑панель ---------- */
    async list(q = {}) {
      const where = []; const args = [];
      const text = String(q.q || '').trim().slice(0, 100);
      if (text) { where.push("(u.email LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')"); args.push('%' + likeEsc(text.toLowerCase()) + '%', '%' + likeEsc(text) + '%'); }
      if (['admin', 'company', 'client'].includes(q.role)) { where.push('u.role=?'); args.push(q.role); }
      if (q.status === 'blocked') where.push('u.disabled=1');
      else if (q.status === 'unverified') where.push("u.disabled=0 AND u.email_verified_at IS NULL AND u.role<>'admin'");
      else if (q.status === 'active') where.push('u.disabled=0');
      const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
      const total = Number((await db.get(`SELECT ${COUNT} AS c FROM users u${w}`, args)).c);
      const pages = Math.max(1, Math.ceil(total / PAGE));
      const page = Math.min(pages, Math.max(1, parseInt(q.page, 10) || 1));
      const rows = await db.all(`SELECT u.*, (SELECT ${COUNT} FROM projects p WHERE p.user_id=u.id AND p.deleted_at IS NULL) AS projects FROM users u${w} ORDER BY u.created_at DESC, u.id LIMIT ? OFFSET ?`, [...args, PAGE, (page - 1) * PAGE]);
      return { users: rows.map(adminDto), total, page, pages, pageSize: PAGE };
    },
    async get(id, projects) {
      const u = await target(id);
      return { user: { ...adminDto(u), providers: await providersOf(u.id), sessions: await sessionsOf(u.id) }, projects: await projects.adminList(u.id) };
    },
    async block(adminUser, id, body) {
      const u = await target(id);
      if (u.id === adminUser.id) throw new ApiError(422, 'self', 'Нельзя заблокировать самого себя');
      if (u.role === 'admin') throw new ApiError(422, 'admin_protected', 'Администраторы управляются переменными окружения — заблокировать их нельзя');
      const reason = String(body.reason || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      await db.run('UPDATE users SET disabled=1, disabled_reason=?, updated_at=? WHERE id=?', [reason, now(), u.id]);
      await db.run('DELETE FROM sessions WHERE user_id=?', [u.id]);
      await db.run('DELETE FROM auth_tokens WHERE user_id=? AND used_at IS NULL', [u.id]);
      return { row: u, reason };
    },
    async unblock(id) {
      const u = await target(id);
      await db.run("UPDATE users SET disabled=0, disabled_reason='', updated_at=? WHERE id=?", [now(), u.id]);
      return u;
    },
    async revokeSessions(id) {
      const u = await target(id);
      const r = await db.run('DELETE FROM sessions WHERE user_id=?', [u.id]);
      return { row: u, revoked: r.changes };
    },
    async total() { return Number((await db.get(`SELECT ${COUNT} AS c FROM users`)).c); },
    adminDto, target,
  };
}

module.exports = { makeUsers };
