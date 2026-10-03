'use strict';
/* Одноразовые токены: подтверждение почты, сброс пароля, код входа через провайдера.
   В базе — только SHA‑256 от токена; сам токен есть лишь в письме или в адресе возврата. */
const crypto = require('node:crypto');

const TTL = { verify: 48 * 3600, reset: 3600, oauth: 120 }; // секунды
const sha = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');
const iso = (ms) => new Date(ms).toISOString();

function makeTokens(db) {
  return {
    TTL,
    /* Создать токен. Прежние токены этого вида у пользователя удаляются — действует только последняя ссылка. */
    async create(userId, kind, meta = {}) {
      const raw = crypto.randomBytes(32).toString('base64url');
      await db.run('DELETE FROM auth_tokens WHERE user_id=? AND kind=?', [userId, kind]);
      await db.run('INSERT INTO auth_tokens (token_hash,user_id,kind,meta,created_at,expires_at) VALUES (?,?,?,?,?,?)',
        [sha(raw), userId, kind, JSON.stringify(meta), iso(Date.now()), iso(Date.now() + TTL[kind] * 1000)]);
      return raw;
    },
    /* Состояние токена без изменения: {state: 'ok'|'used'|'expired'|'invalid', row, user} */
    async find(raw, kind) {
      const s = String(raw || '');
      if (!/^[A-Za-z0-9_-]{20,100}$/.test(s)) return { state: 'invalid' };
      const row = await db.get('SELECT * FROM auth_tokens WHERE token_hash=? AND kind=?', [sha(s), kind]);
      if (!row) return { state: 'invalid' };
      const user = await db.get('SELECT * FROM users WHERE id=?', [row.user_id]);
      if (!user || Number(user.disabled)) return { state: 'invalid' };
      let meta = {}; try { meta = JSON.parse(row.meta || '{}'); } catch {}
      if (row.used_at) return { state: 'used', row, user, meta };
      if (row.expires_at < iso(Date.now())) return { state: 'expired', row, user, meta };
      return { state: 'ok', row, user, meta };
    },
    /* Погасить: одной командой с проверкой числа изменённых строк — два одновременных запроса не используют токен дважды */
    async consume(raw, kind) {
      const r = await db.run('UPDATE auth_tokens SET used_at=? WHERE token_hash=? AND kind=? AND used_at IS NULL AND expires_at>?', [iso(Date.now()), sha(raw), kind, iso(Date.now())]);
      return r.changes === 1;
    },
    async dropUnused(userId, kinds = ['verify', 'reset', 'oauth']) {
      for (const k of kinds) await db.run('DELETE FROM auth_tokens WHERE user_id=? AND kind=? AND used_at IS NULL', [userId, k]);
    },
  };
}

module.exports = { makeTokens, TTL };
