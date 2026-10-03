'use strict';
/* Проекты редактора в аккаунте пользователя. data — JSON проекта целиком (TEXT, чтобы один код работал с SQLite и Postgres).
   Сохранение — с проверкой версии (rev): чужая более новая версия → 409 conflict.
   preview — компактная миниатюра (отрезки стен и счётчики), чтобы список проектов не читал полные данные. */
const crypto = require('node:crypto');
const { ApiError } = require('./catalog.js');

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PER_USER = 50;
const NAME_MAX = 80;
const PREVIEW_WALLS = 200;
const PURGE_DAYS = 30;
const COPY_SUFFIX = ' — копия';
const now = () => new Date().toISOString();

/* Миниатюра: только числа; всё нечисловое отбрасывается */
function makePreview(data) {
  const out = { walls: [], counts: { walls: 0, openings: 0, furniture: 0 }, closed: false };
  if (!data || typeof data !== 'object') return out;
  const V = new Map();
  for (const v of Array.isArray(data.vertices) ? data.vertices : []) {
    if (v && Number.isFinite(+v.x) && Number.isFinite(+v.y)) V.set(String(v.id), [Math.round(+v.x), Math.round(+v.y)]);
  }
  const walls = Array.isArray(data.walls) ? data.walls : [];
  for (const w of walls) {
    if (out.walls.length >= PREVIEW_WALLS) break;
    const a = w && V.get(String(w.a)), b = w && V.get(String(w.b));
    if (a && b) out.walls.push([a[0], a[1], b[0], b[1]]);
  }
  out.counts.walls = walls.length;
  out.counts.openings = Array.isArray(data.openings) ? data.openings.length : 0;
  out.counts.furniture = Array.isArray(data.furniture) ? data.furniture.length : 0;
  out.closed = data.closed === true;
  return out;
}
/* Пустой проект, который сервер создаёт сам (экран «Мои проекты» → «Новый проект»).
   Остальные поля достраивает normalizeProject в редакторе. */
const blankProject = (name) => ({ id: crypto.randomBytes(4).toString('hex'), name, unit: 'mm', vertices: [], walls: [], openings: [], furniture: [], closed: false, status: 'draft', createdAt: now(), updatedAt: now() });

function makeProjects(db) {
  const parsePreview = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
  const meta = (r) => ({ id: r.id, name: r.name, rev: Number(r.rev), size: Number(r.size), createdAt: r.created_at, updatedAt: r.updated_at, preview: parsePreview(r.preview) });

  function cleanName(raw, { required = false } = {}) {
    const s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    if (!s) { if (required) throw new ApiError(422, 'validation', 'Введите название', { fields: { name: 'Введите название' } }); return 'Новый проект'; }
    if (/[\u0000-\u001f\u007f]/.test(s)) throw new ApiError(422, 'validation', 'Название содержит недопустимые символы', { fields: { name: 'Название содержит недопустимые символы' } });
    if (s.length > NAME_MAX) throw new ApiError(422, 'validation', `Название — не длиннее ${NAME_MAX} символов`, { fields: { name: `Название — не длиннее ${NAME_MAX} символов` } });
    return s;
  }
  function serialize(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError(422, 'validation', 'Нет данных проекта');
    for (const k of ['vertices', 'walls', 'openings']) if (!Array.isArray(data[k])) throw new ApiError(422, 'validation', `Некорректный проект: нет массива ${k}`);
    const text = JSON.stringify(data);
    const size = Buffer.byteLength(text);
    if (size > MAX_BYTES) throw new ApiError(413, 'too_large', 'Проект больше 2 МБ');
    return { text, size, preview: JSON.stringify(makePreview(data)) };
  }
  async function own(user, id) {
    const r = await db.get('SELECT * FROM projects WHERE id=? AND deleted_at IS NULL', [String(id)]);
    if (!r || r.user_id !== user.id) throw new ApiError(404, 'not_found', 'Проект не найден');
    return r;
  }
  async function count(user) {
    return Number((await db.get('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM projects WHERE user_id=? AND deleted_at IS NULL', [user.id])).c);
  }
  async function checkLimit(user) {
    if ((await count(user)) >= MAX_PER_USER) throw new ApiError(422, 'limit', `Можно хранить не больше ${MAX_PER_USER} проектов. Удалите ненужные, чтобы создать новый`);
  }

  /* Удалённые проекты стираются окончательно через PURGE_DAYS. Отдельного планировщика нет (на Vercel функции живут недолго),
     поэтому чистка идёт попутно со списком проектов, но не чаще раза в час на процесс. */
  let purgedAt = 0;
  async function purge(force) {
    if (!force && Date.now() - purgedAt < 3600e3) return 0;
    purgedAt = Date.now();
    try { return (await db.run('DELETE FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?', [new Date(Date.now() - PURGE_DAYS * 864e5).toISOString()])).changes; } catch { return 0; }
  }

  return {
    MAX_PER_USER,
    count,
    purge,
    async list(user) {
      await purge();
      const rows = await db.all('SELECT id,name,rev,size,created_at,updated_at,preview FROM projects WHERE user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC, id', [user.id]);
      /* проекты, сохранённые до появления миниатюр: вычисляем один раз */
      for (const r of rows) {
        if (r.preview) continue;
        const full = await db.get('SELECT data FROM projects WHERE id=?', [r.id]);
        let data = null; try { data = JSON.parse(full.data); } catch {}
        r.preview = JSON.stringify(makePreview(data));
        await db.run('UPDATE projects SET preview=? WHERE id=?', [r.preview, r.id]);
      }
      return { projects: rows.map(meta), limit: MAX_PER_USER };
    },
    async get(user, id) {
      const r = await own(user, id);
      let data = null; try { data = JSON.parse(r.data); } catch { data = null; }
      return { ...meta(r), data };
    },
    /* data необязателен: без него создаётся пустой проект в мм */
    async create(user, body) {
      await checkLimit(user);
      const name = cleanName(body.name ?? (body.data && body.data.name));
      const { text, size, preview } = serialize(body.data === undefined || body.data === null ? blankProject(name) : body.data);
      const id = crypto.randomUUID(); const t = now();
      await db.run('INSERT INTO projects (id,user_id,name,data,size,rev,created_at,updated_at,preview) VALUES (?,?,?,?,?,1,?,?,?)', [id, user.id, name, text, size, t, t, preview]);
      return meta({ id, name, rev: 1, size, created_at: t, updated_at: t, preview });
    },
    async update(user, id, body) {
      const r = await own(user, id);
      const rev = Number(body.rev);
      if (!Number.isInteger(rev)) throw new ApiError(422, 'validation', 'Не указана версия проекта (rev)');
      const name = body.name !== undefined ? cleanName(body.name) : r.name;
      const { text, size, preview } = serialize(body.data);
      const t = now();
      const res = await db.run('UPDATE projects SET name=?, data=?, size=?, preview=?, rev=rev+1, updated_at=? WHERE id=? AND user_id=? AND rev=? AND deleted_at IS NULL', [name, text, size, preview, t, r.id, user.id, rev]);
      if (!res.changes) {
        const cur = await own(user, id);
        throw new ApiError(409, 'conflict', 'Проект изменили на другом устройстве', { rev: Number(cur.rev), updatedAt: cur.updated_at });
      }
      return meta({ id: r.id, name, rev: rev + 1, size, created_at: r.created_at, updated_at: t, preview });
    },
    /* Переименование: имя меняется и в колонке, и внутри данных проекта; версия растёт,
       чтобы редактор с прежней версией на другом устройстве не затёр новое имя */
    async rename(user, id, body) {
      const r = await own(user, id);
      const name = cleanName(body.name, { required: true });
      let data = null; try { data = JSON.parse(r.data); } catch {}
      if (!data || typeof data !== 'object') throw new ApiError(422, 'validation', 'Проект повреждён');
      data.name = name;
      const text = JSON.stringify(data); const size = Buffer.byteLength(text); const t = now();
      const res = await db.run('UPDATE projects SET name=?, data=?, size=?, rev=rev+1, updated_at=? WHERE id=? AND user_id=? AND rev=? AND deleted_at IS NULL', [name, text, size, t, r.id, user.id, r.rev]);
      if (!res.changes) throw new ApiError(409, 'conflict', 'Проект только что изменили. Обновите страницу и повторите');
      return meta({ ...r, name, size, rev: Number(r.rev) + 1, updated_at: t });
    },
    async copy(user, id) {
      const r = await own(user, id);
      await checkLimit(user);
      const name = r.name.slice(0, NAME_MAX - COPY_SUFFIX.length).trimEnd() + COPY_SUFFIX;
      let data = null; try { data = JSON.parse(r.data); } catch {}
      if (!data || typeof data !== 'object') throw new ApiError(422, 'validation', 'Проект повреждён');
      data.name = name; data.id = crypto.randomBytes(4).toString('hex'); data.status = 'draft';
      const { text, size, preview } = serialize(data);
      const nid = crypto.randomUUID(); const t = now();
      await db.run('INSERT INTO projects (id,user_id,name,data,size,rev,created_at,updated_at,preview) VALUES (?,?,?,?,?,1,?,?,?)', [nid, user.id, name, text, size, t, t, preview]);
      return meta({ id: nid, name, rev: 1, size, created_at: t, updated_at: t, preview });
    },
    async remove(user, id) {
      const r = await own(user, id);
      await db.run('UPDATE projects SET deleted_at=? WHERE id=?', [now(), r.id]);
      return { ok: true };
    },
    /* Для поддержки: проект любого пользователя целиком, только чтение */
    async adminGet(id) {
      const r = await db.get('SELECT p.*, u.email AS owner_email, u.name AS owner_name FROM projects p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.deleted_at IS NULL', [String(id)]);
      if (!r) throw new ApiError(404, 'not_found', 'Проект не найден');
      let data = null; try { data = JSON.parse(r.data); } catch {}
      return { ...meta(r), data, owner: { id: r.user_id, email: r.owner_email, name: r.owner_name } };
    },
    async adminList(userId) {
      const rows = await db.all('SELECT id,name,rev,size,created_at,updated_at,preview FROM projects WHERE user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC, id', [userId]);
      return rows.map(meta);
    },
  };
}

module.exports = { makeProjects, makePreview, PROJECT_MAX_BYTES: MAX_BYTES };
