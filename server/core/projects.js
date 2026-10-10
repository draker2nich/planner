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
const PREVIEW_FURN = 150;
const PURGE_DAYS = 30;
const TRASH_MAX = 30;      // в корзине одного пользователя — не больше стольких проектов; самые старые стираются раньше срока
const MAX_ITEMS = 3000;    // вершин, стен, проёмов, предметов в одном проекте
const COPY_SUFFIX = ' — копия';
const now = () => new Date().toISOString();

/* Миниатюра: только числа; всё нечисловое отбрасывается */
function makePreview(data) {
  const out = { walls: [], furn: [], counts: { walls: 0, openings: 0, furniture: 0 }, closed: false };
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
  /* мебель — прямоугольники по габариту [центр x, центр y, ширина, глубина, поворот°]: по ним проект узнаётся в списке */
  const num = (v) => (Number.isFinite(+v) && +v > 0 ? +v : null);
  for (const f of Array.isArray(data.furniture) ? data.furniture : []) {
    if (out.furn.length >= PREVIEW_FURN) break;
    if (!f || !Number.isFinite(+f.x) || !Number.isFinite(+f.y)) continue;
    const d = f.dims && typeof f.dims === 'object' ? f.dims : {};
    const w = num(d.W) ?? num(d.A) ?? num(d.DIA) ?? num(d.R) ?? 500;
    const dp = (num(d.A) && num(d.B)) ?? num(d.D) ?? num(d.L) ?? num(d.DIA) ?? num(d.R) ?? 500;
    out.furn.push([Math.round(+f.x), Math.round(+f.y), Math.round(w), Math.round(dp), Math.round(Number.isFinite(+f.rot) ? +f.rot : 0)]);
  }
  return out;
}
/* Идентификаторы фото, на которые ссылается проект. materialsOnly — только текстуры стен и пола (то, что видно в комнате);
   без него — ещё и фото‑референсы из пожеланий. Повторяет usedPhotoIds() редактора (public/js/editor/view3d/materials.js). */
function photoIdsOf(data, { materialsOnly = false } = {}) {
  const out = new Set();
  if (!data || typeof data !== 'object') return out;
  const ok = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(v);
  const mat = (m) => { if (m && m.type === 'photo' && ok(m.photoId)) out.add(m.photoId); };
  const brief = (b) => { if (materialsOnly) return; for (const p of (b && Array.isArray(b.photos) ? b.photos : [])) if (p && ok(p.photoId)) out.add(p.photoId); };
  const cell = (c) => { if (!c || !c.finishes) return; for (const m of Object.values(c.finishes.walls || {})) mat(m); mat(c.finishes.floor); mat(c.finishes.ceiling); };
  for (const w of Array.isArray(data.walls) ? data.walls : []) mat(w && w.material);
  mat(data.floor && data.floor.material); mat(data.ceiling && data.ceiling.material);
  brief(data.brief); brief(data.briefDraft);
  if (data.ai && typeof data.ai === 'object') { brief(data.ai.brief); cell(data.ai.base); for (const k of ['variants', 'prevVariants']) for (const c of Array.isArray(data.ai[k]) ? data.ai[k] : []) cell(c); }
  return out;
}
/* Проект для просмотра по ссылке: комната, мебель и варианты — как есть; личное (тексты пожеланий, фото‑референсы,
   разобранный профиль вкуса, черновик мастера) убирается. Структура брифа остаётся: по ней редактор открывает экран результата. */
function publicData(data) {
  if (!data || typeof data !== 'object') return data;
  const d = JSON.parse(JSON.stringify(data));
  const strip = (b) => { if (b && typeof b === 'object') { b.text = ''; b.photos = []; } };
  strip(d.brief); delete d.briefDraft;
  if (d.ai && typeof d.ai === 'object') { strip(d.ai.brief); d.ai.taste = null; }
  d.photos = [...photoIdsOf(d, { materialsOnly: true })];
  return d;
}
const SHARE_RE = /^[A-Za-z0-9_-]{24,64}$/;
/* Пустой проект, который сервер создаёт сам (экран «Мои проекты» → «Новый проект»).
   Остальные поля достраивает normalizeProject в редакторе. */
const blankProject = (name) => ({ id: crypto.randomBytes(4).toString('hex'), name, unit: 'mm', vertices: [], walls: [], openings: [], furniture: [], closed: false, status: 'draft', createdAt: now(), updatedAt: now() });

function makeProjects(db) {
  const parsePreview = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
  const meta = (r) => ({ id: r.id, name: r.name, rev: Number(r.rev), size: Number(r.size), createdAt: r.created_at, updatedAt: r.updated_at, preview: parsePreview(r.preview), shared: !!r.share_token });
  const LIST = 'id,name,rev,size,created_at,updated_at,preview,share_token';

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
    if (data.furniture !== undefined && !Array.isArray(data.furniture)) throw new ApiError(422, 'validation', 'Некорректный проект: furniture — не массив');
    /* в списках — только объекты и не больше разумного: редактор и миниатюра рассчитывают на эту форму */
    for (const k of ['vertices', 'walls', 'openings', 'furniture']) {
      const a = data[k] || [];
      if (a.length > MAX_ITEMS) throw new ApiError(422, 'validation', `Некорректный проект: слишком много элементов в ${k}`);
      if (a.some((x) => !x || typeof x !== 'object' || Array.isArray(x))) throw new ApiError(422, 'validation', `Некорректный проект: в ${k} есть элемент, который не является объектом`);
    }
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
  /* То же без данных проекта: сохранению и переименованию не нужно читать из базы до 2 МБ JSON */
  async function ownMeta(user, id, { deleted = false } = {}) {
    const r = await db.get(`SELECT ${LIST},user_id,deleted_at FROM projects WHERE id=? AND deleted_at IS ${deleted ? 'NOT NULL' : 'NULL'}`, [String(id)]);
    if (!r || r.user_id !== user.id) throw new ApiError(404, 'not_found', 'Проект не найден');
    return r;
  }
  async function count(user) {
    return Number((await db.get('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM projects WHERE user_id=? AND deleted_at IS NULL', [user.id])).c);
  }
  const limitError = () => new ApiError(422, 'limit', `Можно хранить не больше ${MAX_PER_USER} проектов. Удалите ненужные, чтобы создать новый`);
  async function checkLimit(user) {
    if ((await count(user)) >= MAX_PER_USER) throw limitError();
  }
  /* Проверка после вставки: одновременные запросы вместе проходят checkLimit, поэтому каждый после своей вставки
     пересчитывает проекты и, если их стало больше предела, убирает свою строку. Транзакций на Neon нет, так что при
     одновременном создании у самого предела могут отказать оба запроса — зато предел не превышается никогда. */
  async function enforceLimit(user, id) {
    if ((await count(user)) <= MAX_PER_USER) return;
    await db.run('DELETE FROM projects WHERE id=?', [id]);
    throw limitError();
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
    MAX_PER_USER, PURGE_DAYS, TRASH_MAX,
    count,
    purge,
    async list(user) {
      await purge();
      const rows = await db.all(`SELECT ${LIST} FROM projects WHERE user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC, id`, [user.id]);
      /* проекты, сохранённые до появления миниатюр: вычисляем один раз */
      for (const r of rows) {
        if (r.preview) continue;
        const full = await db.get('SELECT data FROM projects WHERE id=?', [r.id]);
        let data = null; try { data = JSON.parse(full.data); } catch {}
        r.preview = JSON.stringify(makePreview(data));
        await db.run('UPDATE projects SET preview=? WHERE id=?', [r.preview, r.id]);
      }
      const trash = Number((await db.get('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM projects WHERE user_id=? AND deleted_at IS NOT NULL', [user.id])).c);
      return { projects: rows.map(meta), limit: MAX_PER_USER, trash };
    },
    async get(user, id) {
      const r = await own(user, id);
      let data = null; try { data = JSON.parse(r.data); } catch { data = null; }
      return { ...meta(r), data, share: r.share_token || null };
    },
    /* data необязателен: без него создаётся пустой проект в мм */
    async create(user, body) {
      await checkLimit(user);
      const name = cleanName(body.name ?? (body.data && body.data.name));
      const { text, size, preview } = serialize(body.data === undefined || body.data === null ? blankProject(name) : body.data);
      const id = crypto.randomUUID(); const t = now();
      await db.run('INSERT INTO projects (id,user_id,name,data,size,rev,created_at,updated_at,preview) VALUES (?,?,?,?,?,1,?,?,?)', [id, user.id, name, text, size, t, t, preview]);
      await enforceLimit(user, id);
      return meta({ id, name, rev: 1, size, created_at: t, updated_at: t, preview });
    },
    async update(user, id, body) {
      const r = await ownMeta(user, id);
      const rev = Number(body.rev);
      if (!Number.isInteger(rev)) throw new ApiError(422, 'validation', 'Не указана версия проекта (rev)');
      const name = body.name !== undefined ? cleanName(body.name) : r.name;
      const { text, size, preview } = serialize(body.data);
      const t = now();
      const res = await db.run('UPDATE projects SET name=?, data=?, size=?, preview=?, rev=rev+1, updated_at=? WHERE id=? AND user_id=? AND rev=? AND deleted_at IS NULL', [name, text, size, preview, t, r.id, user.id, rev]);
      if (!res.changes) {
        const cur = await ownMeta(user, id);
        throw new ApiError(409, 'conflict', 'Проект изменили на другом устройстве', { rev: Number(cur.rev), updatedAt: cur.updated_at });
      }
      return meta({ id: r.id, name, rev: rev + 1, size, created_at: r.created_at, updated_at: t, preview, share_token: r.share_token });
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
      if (size > MAX_BYTES) throw new ApiError(413, 'too_large', 'Проект больше 2 МБ');
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
      /* проект, сохранённый до проверки формы списков, копируется без «мусорных» элементов — иначе копию нельзя было бы создать */
      for (const k of ['vertices', 'walls', 'openings', 'furniture']) if (Array.isArray(data[k])) data[k] = data[k].filter((x) => x && typeof x === 'object' && !Array.isArray(x));
      data.name = name; data.id = crypto.randomBytes(4).toString('hex'); data.status = 'draft';
      const { text, size, preview } = serialize(data);
      const nid = crypto.randomUUID(); const t = now();
      await db.run('INSERT INTO projects (id,user_id,name,data,size,rev,created_at,updated_at,preview) VALUES (?,?,?,?,?,1,?,?,?)', [nid, user.id, name, text, size, t, t, preview]);
      await enforceLimit(user, nid);
      return meta({ id: nid, name, rev: 1, size, created_at: t, updated_at: t, preview });
    },
    /* Удаление — в корзину на PURGE_DAYS суток. Корзина ограничена: иначе удалёнными проектами можно занять сколько угодно места. */
    async remove(user, id) {
      const r = await ownMeta(user, id);
      await db.run('UPDATE projects SET deleted_at=?, share_token=NULL WHERE id=?', [now(), r.id]); // ссылка на удалённый проект перестаёт работать сразу
      try {
        const old = await db.all('SELECT id FROM projects WHERE user_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC, id LIMIT 1000 OFFSET ?', [user.id, TRASH_MAX]);
        for (const o of old) await db.run('DELETE FROM projects WHERE id=? AND deleted_at IS NOT NULL', [o.id]);
      } catch (e) { console.error('trash:', e.message); }
      return { ok: true, restorableDays: PURGE_DAYS };
    },
    /* ---------- корзина ---------- */
    async trash(user) {
      await purge();
      const rows = await db.all(`SELECT ${LIST},deleted_at FROM projects WHERE user_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC, id`, [user.id]);
      return { projects: rows.map((r) => ({ ...meta(r), deletedAt: r.deleted_at, purgeAt: new Date(Date.parse(r.deleted_at) + PURGE_DAYS * 864e5).toISOString() })), days: PURGE_DAYS };
    },
    async restore(user, id) {
      const r = await ownMeta(user, id, { deleted: true });
      await checkLimit(user);
      await db.run('UPDATE projects SET deleted_at=NULL WHERE id=? AND user_id=?', [r.id, user.id]);
      /* два одновременных восстановления могли вместе превысить лимит — тогда проект возвращается в корзину */
      if ((await count(user)) > MAX_PER_USER) {
        await db.run('UPDATE projects SET deleted_at=? WHERE id=?', [r.deleted_at, r.id]);
        throw limitError();
      }
      return meta(r);
    },
    /* стереть из корзины сразу, не дожидаясь срока */
    async destroy(user, id) {
      const r = await ownMeta(user, id, { deleted: true });
      await db.run('DELETE FROM projects WHERE id=? AND user_id=? AND deleted_at IS NOT NULL', [r.id, user.id]);
      return { ok: true };
    },
    own, ownMeta,
    /* ---------- ссылка для просмотра ----------
       Кто знает ссылку, видит проект без входа и только для чтения. Ссылка одна на проект; владелец может её отключить —
       тогда прежний адрес перестаёт работать, а новая ссылка получит другой адрес. */
    async share(user, id) {
      const r = await own(user, id);
      if (r.share_token) return { token: r.share_token };
      const token = crypto.randomBytes(24).toString('base64url');
      await db.run('UPDATE projects SET share_token=? WHERE id=? AND share_token IS NULL', [token, r.id]);
      return { token: (await db.get('SELECT share_token FROM projects WHERE id=?', [r.id])).share_token };
    },
    async unshare(user, id) {
      const r = await own(user, id);
      await db.run('UPDATE projects SET share_token=NULL WHERE id=?', [r.id]);
      return { ok: true };
    },
    /* → строка проекта по ссылке или 404 */
    async sharedRow(token) {
      const r = SHARE_RE.test(String(token || '')) ? await db.get('SELECT * FROM projects WHERE share_token=? AND deleted_at IS NULL', [String(token)]) : null;
      if (!r) throw new ApiError(404, 'not_found', 'Ссылка недействительна или отключена владельцем');
      return r;
    },
    async sharedGet(token) {
      const r = await this.sharedRow(token);
      let data = null; try { data = JSON.parse(r.data); } catch {}
      return { name: r.name, rev: Number(r.rev), updatedAt: r.updated_at, data: publicData(data) };
    },
    /* Для поддержки: проект любого пользователя целиком, только чтение */
    async adminGet(id) {
      const r = await db.get('SELECT p.*, u.email AS owner_email, u.name AS owner_name FROM projects p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.deleted_at IS NULL', [String(id)]);
      if (!r) throw new ApiError(404, 'not_found', 'Проект не найден');
      let data = null; try { data = JSON.parse(r.data); } catch {}
      return { ...meta(r), data, owner: { id: r.user_id, email: r.owner_email, name: r.owner_name } };
    },
    async adminList(userId) {
      const rows = await db.all(`SELECT ${LIST} FROM projects WHERE user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC, id`, [userId]);
      return rows.map(meta);
    },
  };
}

module.exports = { makeProjects, makePreview, photoIdsOf, publicData, PROJECT_MAX_BYTES: MAX_BYTES };
