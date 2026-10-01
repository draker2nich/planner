'use strict';
/* Проекты редактора в аккаунте пользователя. data — JSON проекта целиком (TEXT, чтобы один код работал с SQLite и Postgres).
   Сохранение — с проверкой версии (rev): чужая более новая версия → 409 conflict. */
const crypto = require('node:crypto');
const { ApiError } = require('./catalog.js');

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PER_USER = 50;
const NAME_MAX = 80;
const now = () => new Date().toISOString();

function makeProjects(db) {
  const meta = (r) => ({ id: r.id, name: r.name, rev: Number(r.rev), size: Number(r.size), createdAt: r.created_at, updatedAt: r.updated_at });

  function cleanName(raw) {
    const s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    if (!s) return 'Новый проект';
    if (s.length > NAME_MAX) throw new ApiError(422, 'validation', `Название — не длиннее ${NAME_MAX} символов`, { fields: { name: 'too_long' } });
    return s;
  }
  function serialize(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError(422, 'validation', 'Нет данных проекта');
    for (const k of ['vertices', 'walls', 'openings']) if (!Array.isArray(data[k])) throw new ApiError(422, 'validation', `Некорректный проект: нет массива ${k}`);
    const text = JSON.stringify(data);
    const size = Buffer.byteLength(text);
    if (size > MAX_BYTES) throw new ApiError(413, 'too_large', 'Проект больше 2 МБ');
    return { text, size };
  }
  async function own(user, id) {
    const r = await db.get('SELECT * FROM projects WHERE id=? AND deleted_at IS NULL', [String(id)]);
    if (!r || r.user_id !== user.id) throw new ApiError(404, 'not_found', 'Проект не найден');
    return r;
  }

  return {
    async list(user) {
      const rows = await db.all('SELECT id,name,rev,size,created_at,updated_at FROM projects WHERE user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC', [user.id]);
      return { projects: rows.map(meta) };
    },
    async get(user, id) {
      const r = await own(user, id);
      let data = null; try { data = JSON.parse(r.data); } catch { data = null; }
      return { ...meta(r), data };
    },
    async create(user, body) {
      const n = Number((await db.get('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM projects WHERE user_id=? AND deleted_at IS NULL', [user.id])).c);
      if (n >= MAX_PER_USER) throw new ApiError(422, 'limit', `Можно хранить не больше ${MAX_PER_USER} проектов`);
      const name = cleanName(body.name ?? (body.data && body.data.name));
      const { text, size } = serialize(body.data);
      const id = crypto.randomUUID(); const t = now();
      await db.run('INSERT INTO projects (id,user_id,name,data,size,rev,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)', [id, user.id, name, text, size, t, t]);
      return { id, name, rev: 1, size, createdAt: t, updatedAt: t };
    },
    async update(user, id, body) {
      const r = await own(user, id);
      const rev = Number(body.rev);
      if (!Number.isInteger(rev)) throw new ApiError(422, 'validation', 'Не указана версия проекта (rev)');
      const name = body.name !== undefined ? cleanName(body.name) : r.name;
      const { text, size } = serialize(body.data);
      const t = now();
      const res = await db.run('UPDATE projects SET name=?, data=?, size=?, rev=rev+1, updated_at=? WHERE id=? AND user_id=? AND rev=? AND deleted_at IS NULL', [name, text, size, t, r.id, user.id, rev]);
      if (!res.changes) {
        const cur = await own(user, id);
        throw new ApiError(409, 'conflict', 'Проект изменили на другом устройстве', { rev: Number(cur.rev), updatedAt: cur.updated_at });
      }
      return { id: r.id, name, rev: rev + 1, size, createdAt: r.created_at, updatedAt: t };
    },
    async remove(user, id) {
      const r = await own(user, id);
      await db.run('UPDATE projects SET deleted_at=? WHERE id=?', [now(), r.id]);
      return { ok: true };
    },
  };
}

module.exports = { makeProjects, PROJECT_MAX_BYTES: MAX_BYTES };
