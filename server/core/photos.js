'use strict';
/* Фото пользователя в аккаунте: референсы для ИИ‑дизайнера и свои текстуры стен и пола.
   Раньше они лежали только в браузере (IndexedDB) и на другом устройстве пропадали. Теперь браузер держит у себя копию
   для быстрой работы, а сервер — копию для остальных устройств.

   Фото принадлежит пользователю, а не проекту: копия проекта ссылается на те же идентификаторы и ничего не дублирует.
   Файл лежит в хранилище платформы (локально — папка uploads, на Vercel — Blob) под ключом users/<пользователь>/photos/…,
   в таблице user_photos — только сведения о нём. Адрес файла наружу не отдаётся: фото читается через API
   с проверкой прав (владелец; поддержка — для просматриваемого проекта; гость по ссылке — только текстуры комнаты). */
const { ApiError } = require('./catalog.js');
const { photoIdsOf } = require('./projects.js');

const MAX_BYTES = 2 * 1024 * 1024;   // браузер присылает уже уменьшенную копию
const MAX_PER_USER = 200;
const ID_RE = /^[A-Za-z0-9_-]{4,40}$/;
const SIG = [
  ['image/jpeg', 'jpg', (b) => b[0] === 0xff && b[1] === 0xd8],
  ['image/png', 'png', (b) => b.readUInt32BE(0) === 0x89504e47],
  ['image/webp', 'webp', (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'],
];
const sniff = (buf) => (buf.length > 12 ? SIG.find(([, , f]) => f(buf)) : null);
const now = () => new Date().toISOString();
const dim = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 && n <= 20000 ? n : 0; };

function makePhotos(db, storage) {
  const checkId = (id) => { if (!ID_RE.test(String(id || ''))) throw new ApiError(422, 'validation', 'Некорректный идентификатор фото'); return String(id); };
  const notFound = () => new ApiError(404, 'not_found', 'Фото не найдено');
  const rowOf = (userId, id) => db.get('SELECT * FROM user_photos WHERE user_id=? AND id=?', [userId, id]);
  async function read(userId, id) {
    const r = await rowOf(userId, checkId(id));
    if (!r) throw notFound();
    let buf;
    try { buf = await storage.read(r.file); } catch (e) { console.error('photo read:', e.message); throw notFound(); }
    return { id: r.id, mime: r.mime, w: Number(r.w), h: Number(r.h), bytes: buf.length, data: buf.toString('base64') };
  }

  return {
    MAX_BYTES, MAX_PER_USER,
    /* какие фото уже есть в аккаунте — чтобы браузер дослал недостающие */
    async list(user) {
      const rows = await db.all('SELECT id, bytes, created_at FROM user_photos WHERE user_id=? ORDER BY created_at DESC, id', [user.id]);
      return { photos: rows.map((r) => ({ id: r.id, bytes: Number(r.bytes), createdAt: r.created_at })), limit: MAX_PER_USER, maxBytes: MAX_BYTES };
    },
    /* Загрузка идемпотентна: фото с таким идентификатором уже есть — ничего не меняется */
    async put(user, id, buf, q = {}) {
      const pid = checkId(id);
      if (!buf.length) throw new ApiError(400, 'empty', 'Пустой файл');
      if (buf.length > MAX_BYTES) throw new ApiError(413, 'too_large', 'Фото больше 2 МБ');
      const sig = sniff(buf);
      if (!sig) throw new ApiError(415, 'bad_image', 'Нужен JPG, PNG или WebP');
      if (await rowOf(user.id, pid)) return { ok: true, id: pid, existed: true };
      const n = Number((await db.get('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM user_photos WHERE user_id=?', [user.id])).c);
      if (n >= MAX_PER_USER) throw new ApiError(422, 'limit', `В аккаунте можно хранить не больше ${MAX_PER_USER} фото. Удалите неиспользуемые в панели материалов`);
      const file = await storage.put(`users/${user.id}/photos/${pid}.${sig[1]}`, buf, sig[0]);
      try {
        await db.run('INSERT INTO user_photos (user_id,id,file,mime,w,h,bytes,created_at) VALUES (?,?,?,?,?,?,?,?)', [user.id, pid, file, sig[0], dim(q.w), dim(q.h), buf.length, now()]);
      } catch (e) {
        if (!/unique|duplicate|constraint/i.test(e.message)) { await storage.remove(file); throw e; }
        /* параллельная загрузка того же фото из другой вкладки уже записала строку; свой файл лишний, если адрес другой */
        const cur = await rowOf(user.id, pid);
        if (cur && cur.file !== file) await storage.remove(file);
        return { ok: true, id: pid, existed: true };
      }
      return { ok: true, id: pid };
    },
    get: (user, id) => read(user.id, id),
    /* Удаление. Фото, на которое ссылается другой проект пользователя (например, копия), остаётся:
       exceptProject — проект, из которого удаляют (в нём ссылка могла ещё не успеть исчезнуть из сохранённых данных). */
    async remove(user, id, exceptProject) {
      const pid = checkId(id);
      const r = await rowOf(user.id, pid);
      if (!r) return { ok: true, removed: false };
      const used = await db.all("SELECT id FROM projects WHERE user_id=? AND deleted_at IS NULL AND data LIKE ? ESCAPE '\\'", [user.id, `%"${pid.replace(/[\\%_]/g, (c) => '\\' + c)}"%`]);
      if (used.some((p) => p.id !== exceptProject)) return { ok: true, removed: false, kept: true };
      await db.run('DELETE FROM user_photos WHERE user_id=? AND id=?', [user.id, pid]);
      await storage.remove(r.file);
      return { ok: true, removed: true };
    },
    /* Фото проекта для того, кто не владелец: поддержка (все фото проекта) и гость по ссылке (только текстуры комнаты) */
    async ofProject(projectRow, id, { materialsOnly }) {
      const pid = checkId(id);
      let data = null; try { data = JSON.parse(projectRow.data); } catch {}
      if (!photoIdsOf(data, { materialsOnly }).has(pid)) throw notFound();
      return read(projectRow.user_id, pid);
    },
    /* Все файлы пользователя — при удалении аккаунта (строки таблицы уходят каскадом) */
    async removeAll(userId) {
      try { await storage.removePrefix(`users/${userId}/`); } catch (e) { console.error('photos removeAll:', e.message); }
    },
  };
}

module.exports = { makePhotos, sniff };
