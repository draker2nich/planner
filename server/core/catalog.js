'use strict';
/* Каталог товаров: проверка данных, жизненный цикл, 3D‑модели и фото. Работает с любым драйвером БД и хранилища. */
const crypto = require('node:crypto');
const T = require('../../public/shared/catalog-types.js');
const glb = require('./glb.js');

const now = () => new Date().toISOString();
const J = (s, d) => { try { return typeof s === 'string' ? JSON.parse(s) : (s ?? d); } catch { return d; } };
const N = (v) => Number(v ?? 0);
const CURRENCIES = ['USD', 'EUR', 'RUB', 'BYN', 'KZT', 'UAH', 'GBP'];
const LIMITS = { glbBytes: 50 * 1024 * 1024, imageBytes: 15 * 1024 * 1024, images: 10, dimMin: 10, dimMax: 20000, nameMax: 120 };
const COUNT = 'CAST(COUNT(*) AS INTEGER)';
const searchText = (name, brand) => `${name || ''} ${brand || ''}`.toLowerCase().replace(/ё/g, 'е').trim();

class ApiError extends Error { constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; } }

const IMG_SIG = [['image/jpeg', b => b[0] === 0xff && b[1] === 0xd8, 'jpg'], ['image/png', b => b.readUInt32BE(0) === 0x89504e47, 'png'], ['image/webp', b => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP', 'webp']];
const sniffImage = (buf) => buf.length > 12 ? IMG_SIG.find(([, f]) => f(buf)) : null;

function makeCatalog(db, storage) {
  const url = (ref) => storage.urlOf(ref);

  async function row(id) { const p = await db.get('SELECT * FROM products WHERE id = ?', [id]); if (!p) throw new ApiError(404, 'not_found', 'Товар не найден'); return p; }
  const images = (id) => db.all('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort, created_at', [id]);

  function expectedExtents(p) {
    const t = T.TYPE.get(p.type_id), fo = T.formOf(t, p.form_id), d = J(p.dims, {});
    const e = T.footprintExtents(fo.fp, d);
    return { w: e.w, d: e.d, h: d.H };
  }

  async function dto(p, withImages = true) {
    return {
      id: p.id, ownerCompanyId: p.owner_company_id, source: p.source,
      typeId: p.type_id, formId: p.form_id, name: p.name, brand: p.brand, price: N(p.price), currency: p.currency,
      dims: J(p.dims, {}), colors: J(p.colors, []), materials: J(p.materials, []), styleTags: J(p.style_tags, []), url: p.url,
      status: p.status, rejectReason: p.reject_reason,
      model: { status: p.model_status, source: p.model_source, url: url(p.model_file), info: J(p.model_info, {}) },
      images: withImages ? (await images(p.id)).map(i => ({ id: i.id, url: url(i.file), mime: i.mime })) : undefined,
      createdAt: p.created_at, updatedAt: p.updated_at,
    };
  }
  function publicDto(p, imgs) {
    const info = J(p.model_info, {});
    return {
      id: p.id, typeId: p.type_id, formId: p.form_id, name: p.name, brand: p.brand, price: N(p.price), currency: p.currency,
      dims: J(p.dims, {}), colors: J(p.colors, []), materials: J(p.materials, []), styleTags: J(p.style_tags, []), url: p.url,
      images: (imgs || []).map(i => ({ url: url(i.file) })),
      model: p.model_status === 'ready' && p.model_file ? { url: url(p.model_file), size: info.bbox?.size } : null,
    };
  }

  /* ---------- проверка полей ---------- */
  function normalize(input, base) {
    const out = {}, errors = {};
    const typeId = input.typeId ?? base?.type_id;
    const t = T.TYPE.get(typeId);
    if (!t) errors.typeId = 'Выберите категорию';
    const formId = input.formId ?? base?.form_id;
    const fo = t && t.forms.find(f => f.id === formId);
    if (t && !fo) errors.formId = 'Выберите форму';
    if ('name' in input || !base) {
      const n = String(input.name ?? '').trim();
      if (!n) errors.name = 'Введите название'; else if (n.length > LIMITS.nameMax) errors.name = `Не больше ${LIMITS.nameMax} символов`;
      out.name = n;
    }
    if ('brand' in input) out.brand = String(input.brand || '').trim().slice(0, 80);
    if ('price' in input || !base) {
      const pr = Number(input.price);
      if (input.price === '' || input.price == null || !isFinite(pr) || pr < 0) errors.price = 'Цена — число от 0'; else out.price = Math.round(pr * 100) / 100;
    }
    if ('currency' in input) { if (!CURRENCIES.includes(input.currency)) errors.currency = 'Неизвестная валюта'; else out.currency = input.currency; }
    if ('url' in input) out.url = String(input.url || '').trim().slice(0, 500);
    for (const k of ['colors', 'materials', 'styleTags']) if (k in input) {
      if (!Array.isArray(input[k])) errors[k] = 'Ожидается список'; else out[k] = input[k].map(x => typeof x === 'string' ? x.trim().slice(0, 40) : x).filter(Boolean).slice(0, 20);
    }
    if (fo && ('dims' in input || typeId !== base?.type_id || formId !== base?.form_id)) {
      const src = input.dims ?? J(base?.dims, {});
      const d = {}, de = {};
      for (const k of T.formDimKeys(fo)) {
        const v = Number(src[k]);
        if (k === 'E') { if (src[k] == null || src[k] === '') { d.E = fo.typical.E; continue; } if (!isFinite(v) || v < 0 || v > 10000) de[k] = 'От 0 до 10 000 мм'; else d.E = Math.round(v); continue; }
        if (src[k] === '' || src[k] == null || !isFinite(v) || v < LIMITS.dimMin || v > LIMITS.dimMax) de[k] = `${T.DIMN[k] || k}: от ${LIMITS.dimMin} до ${LIMITS.dimMax} мм`; else d[k] = Math.round(v);
      }
      if (Object.keys(de).length) errors.dims = de; else out.dims = d;
    }
    if (t) out.typeId = typeId; if (fo) out.formId = formId;
    if (Object.keys(errors).length) throw new ApiError(422, 'validation', 'Проверьте поля товара', errors);
    return out;
  }

  const audit = (user, action, entityId, data = {}) =>
    db.run('INSERT INTO audit_log (user_id,action,entity,entity_id,data,at) VALUES (?,?,?,?,?,?)', [user?.id ?? null, action, 'product', entityId, JSON.stringify(data), now()]);

  async function recheckModel(id) {
    const p = await row(id);
    if (!p.model_file || !['ready', 'mismatch'].includes(p.model_status)) return;
    const info = J(p.model_info, {}); if (!info.bbox) return;
    const check = glb.checkAgainst(info, expectedExtents(p));
    info.check = check;
    await db.run('UPDATE products SET model_status=?, model_info=? WHERE id=?', [check.ok ? 'ready' : 'mismatch', JSON.stringify(info), id]);
  }

  /* ---------- CRUD ---------- */
  async function list(q = {}) {
    const where = [], args = [];
    if (q.q) { for (const w of searchText(q.q, '').split(/\s+/).filter(Boolean).slice(0, 5)) { where.push('search LIKE ?'); args.push(`%${w.replace(/[%_]/g, '')}%`); } }
    if (q.typeId) { where.push('type_id = ?'); args.push(q.typeId); }
    if (q.cat) { const ids = T.TYPES.filter(t => t.cats.includes(q.cat)).map(t => t.id); where.push(ids.length ? `type_id IN (${ids.map(() => '?').join(',')})` : '1=0'); args.push(...ids); }
    if (q.status) { where.push('status = ?'); args.push(q.status); }
    if (q.model === 'with') where.push("model_status = 'ready'");
    if (q.model === 'without') where.push("model_status = 'none'");
    if (q.model === 'problem') where.push("model_status IN ('mismatch','failed')");
    if (q.source) { where.push('source = ?'); args.push(q.source); }
    if (q.ownerCompanyId) { where.push('owner_company_id = ?'); args.push(q.ownerCompanyId); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const limit = Math.min(Math.max(parseInt(q.limit) || 50, 1), 200), offset = Math.max(parseInt(q.offset) || 0, 0);
    const total = N((await db.get(`SELECT ${COUNT} AS c FROM products ${w}`, args)).c);
    const rows = await db.all(`SELECT * FROM products ${w} ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`, [...args, limit, offset]);
    const ids = rows.map(r => r.id);
    const thumbs = new Map();
    if (ids.length) for (const im of await db.all(`SELECT product_id, file, sort, created_at FROM product_images WHERE product_id IN (${ids.map(() => '?').join(',')}) ORDER BY sort, created_at`, ids)) if (!thumbs.has(im.product_id)) thumbs.set(im.product_id, url(im.file));
    const items = [];
    for (const p of rows) items.push({ ...(await dto(p, false)), thumb: thumbs.get(p.id) || null });
    return { total, items };
  }

  async function create(user, input) {
    const v = normalize(input, null);
    const id = crypto.randomUUID(), t = now();
    await db.run(`INSERT INTO products (id,owner_company_id,source,type_id,form_id,name,brand,price,currency,dims,colors,materials,style_tags,url,status,created_by,created_at,updated_at,search)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?)`, [
      id, user.role === 'company' ? user.companyId : null, user.role === 'company' ? 'company' : 'admin', v.typeId, v.formId, v.name, v.brand || '', v.price ?? 0, v.currency || 'USD',
      JSON.stringify(v.dims || {}), JSON.stringify(v.colors || []), JSON.stringify(v.materials || []), JSON.stringify(v.styleTags || []), v.url || '', user.id, t, t, searchText(v.name, v.brand)]);
    await audit(user, 'create', id);
    return dto(await row(id));
  }

  async function update(user, id, input) {
    const p = await row(id);
    const v = normalize(input, p);
    const map = { typeId: 'type_id', formId: 'form_id', name: 'name', brand: 'brand', price: 'price', currency: 'currency', url: 'url' };
    const sets = [], args = [];
    for (const k in map) if (k in v) { sets.push(`${map[k]} = ?`); args.push(v[k]); }
    if (v.dims) { sets.push('dims = ?'); args.push(JSON.stringify(v.dims)); }
    for (const [k, c] of [['colors', 'colors'], ['materials', 'materials'], ['styleTags', 'style_tags']]) if (v[k]) { sets.push(`${c} = ?`); args.push(JSON.stringify(v[k])); }
    if ('name' in v || 'brand' in v) { sets.push('search = ?'); args.push(searchText(v.name ?? p.name, v.brand ?? p.brand)); }
    if (!sets.length) return dto(p);
    sets.push('updated_at = ?'); args.push(now());
    if (user.role === 'company' && p.status === 'published') sets.push("status = 'review'"); // правка компании → снова модерация (заложено)
    await db.run(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, [...args, id]);
    if (v.dims || v.formId || v.typeId) await recheckModel(id);
    await audit(user, 'update', id, Object.keys(v));
    return dto(await row(id));
  }

  async function remove(user, id) {
    const p = await row(id);
    const files = [p.model_file, ...(await images(id)).map(i => i.file)].filter(Boolean);
    await db.run('DELETE FROM product_images WHERE product_id = ?', [id]);
    await db.run('DELETE FROM products WHERE id = ?', [id]);
    for (const f of files) await storage.remove(f);
    await audit(user, 'delete', id, { name: p.name });
  }

  function publishProblems(p) {
    const probs = [];
    const t = T.TYPE.get(p.type_id), fo = t && T.formOf(t, p.form_id), d = J(p.dims, {});
    if (!p.name) probs.push('Нет названия');
    if (!fo) probs.push('Не выбрана категория или форма');
    else for (const k of T.formDimKeys(fo)) if (k !== 'E' && !(d[k] > 0)) probs.push(`Не указан размер «${T.DIMN[k] || k}»`);
    if (!(N(p.price) >= 0)) probs.push('Не указана цена');
    if (p.model_status === 'mismatch') probs.push('Размеры 3D‑модели не совпадают с размерами товара');
    if (p.model_status === 'generating') probs.push('3D‑модель ещё генерируется');
    if (p.model_status === 'failed') probs.push('3D‑модель с ошибкой — загрузите заново или удалите');
    return probs;
  }

  const TRANSITIONS = {
    publish: { from: ['draft', 'review', 'rejected', 'archived'], to: 'published', perm: 'product.publish' },
    unpublish: { from: ['published'], to: 'draft', perm: 'product.publish' },
    submit: { from: ['draft', 'rejected'], to: 'review', perm: 'product.submit' },
    reject: { from: ['review'], to: 'rejected', perm: 'product.reject' },
    archive: { from: ['draft', 'review', 'published', 'rejected'], to: 'archived', perm: 'product.publish' },
  };
  async function transition(user, id, action, { reason } = {}, can) {
    const p = await row(id);
    const tr = TRANSITIONS[action];
    if (!tr) throw new ApiError(400, 'bad_action', 'Неизвестное действие');
    if (!can(user, tr.perm, p)) throw new ApiError(403, 'forbidden', 'Недостаточно прав');
    if (!tr.from.includes(p.status)) throw new ApiError(409, 'bad_status', `Нельзя из статуса «${p.status}»`);
    if (tr.to === 'published' || tr.to === 'review') { const pr = publishProblems(p); if (pr.length) throw new ApiError(422, 'not_ready', 'Товар нельзя опубликовать', pr); }
    if (action === 'reject' && !String(reason || '').trim()) throw new ApiError(422, 'validation', 'Укажите причину отклонения');
    await db.run('UPDATE products SET status = ?, reject_reason = ?, updated_at = ? WHERE id = ?', [tr.to, action === 'reject' ? String(reason).trim() : '', now(), id]);
    await audit(user, action, id, { from: p.status, to: tr.to, reason });
    return dto(await row(id));
  }

  /* ---------- 3D‑модель ----------
     buf — содержимое GLB; storedUrl — если файл уже лежит в хранилище (загрузка напрямую из браузера в Vercel Blob). */
  async function attachModel(user, id, buf, storedUrl) {
    const p = await row(id);
    const reject = async (e) => { if (storedUrl) await storage.remove(storedUrl); throw e; };
    if (!buf.length) return reject(new ApiError(400, 'empty', 'Пустой файл'));
    if (buf.length > LIMITS.glbBytes) return reject(new ApiError(413, 'too_large', 'Файл больше 50 МБ'));
    let info;
    try { info = glb.analyze(buf); } catch (e) { if (e instanceof glb.GlbError) return reject(new ApiError(422, e.code, e.message)); throw e; }
    if (info.tris > 1000000) return reject(new ApiError(422, 'too_heavy', `Слишком тяжёлая модель: ${info.tris.toLocaleString('ru')} треугольников (максимум 1 000 000)`));
    const check = glb.checkAgainst(info, expectedExtents(p));
    const fileUrl = storedUrl || await storage.put(`products/${id}/model-${Date.now()}.glb`, buf, 'model/gltf-binary');
    if (p.model_file && p.model_file !== fileUrl) await storage.remove(p.model_file);
    const full = { ...info, bytes: buf.length, check, uploadedAt: now() };
    await db.run("UPDATE products SET model_status=?, model_source='upload', model_file=?, model_info=?, updated_at=? WHERE id=?",
      [check.ok ? 'ready' : 'mismatch', fileUrl, JSON.stringify(full), now(), id]);
    await audit(user, 'model.upload', id, { ok: check.ok, bytes: buf.length });
    return dto(await row(id));
  }
  async function deleteModel(user, id) {
    const p = await row(id);
    if (p.model_file) await storage.remove(p.model_file);
    await db.run("UPDATE products SET model_status='none', model_source=NULL, model_file=NULL, model_info='{}', updated_at=? WHERE id=?", [now(), id]);
    await audit(user, 'model.delete', id);
    return dto(await row(id));
  }
  async function fitDimsToModel(user, id) {
    const p = await row(id); const info = J(p.model_info, {});
    if (!info.bbox) throw new ApiError(409, 'no_model', 'Нет загруженной модели');
    const t = T.TYPE.get(p.type_id), fo = T.formOf(t, p.form_id), d = { ...J(p.dims, {}) };
    const [x, y, z] = info.bbox.size.map(v => Math.round(v * 1000));
    d.H = y;
    switch (fo.fp) {
      case 'circle': d.DIA = Math.round((x + z) / 2); break;
      case 'square': d.W = Math.round((x + z) / 2); break;
      case 'L': case 'U': d.A = x; d.B = z; break;
      case 'quarter': d.R = Math.round((x + z) / 2); break;
      default: if (fo.dims.includes('W')) d.W = x; if (fo.dims.includes('D')) d.D = z; if (fo.dims.includes('L')) d.L = z;
    }
    return update(user, id, { dims: d });
  }
  function requestGeneration() {
    throw new ApiError(501, 'not_implemented', 'Генерация 3D‑модели по фото появится на следующем этапе. Пока загрузите готовую модель GLB.');
  }

  /* ---------- фото ---------- */
  async function attachImage(user, id, buf, storedUrl) {
    await row(id);
    const reject = async (e) => { if (storedUrl) await storage.remove(storedUrl); throw e; };
    if (buf.length > LIMITS.imageBytes) return reject(new ApiError(413, 'too_large', 'Фото больше 15 МБ'));
    const sig = sniffImage(buf);
    if (!sig) return reject(new ApiError(415, 'bad_image', 'Нужен JPG, PNG или WebP'));
    const count = N((await db.get(`SELECT ${COUNT} AS c FROM product_images WHERE product_id = ?`, [id])).c);
    if (count >= LIMITS.images) return reject(new ApiError(422, 'too_many', `Не больше ${LIMITS.images} фото`));
    const imgId = crypto.randomUUID();
    const fileUrl = storedUrl || await storage.put(`products/${id}/img-${imgId}.${sig[2]}`, buf, sig[0]);
    await db.run('INSERT INTO product_images (id,product_id,file,mime,sort,created_at) VALUES (?,?,?,?,?,?)', [imgId, id, fileUrl, sig[0], count, now()]);
    await db.run('UPDATE products SET updated_at=? WHERE id=?', [now(), id]);
    await audit(user, 'image.add', id);
    return dto(await row(id));
  }
  async function deleteImage(user, id, imgId) {
    const im = await db.get('SELECT * FROM product_images WHERE id = ? AND product_id = ?', [imgId, id]);
    if (!im) throw new ApiError(404, 'not_found', 'Фото не найдено');
    await db.run('DELETE FROM product_images WHERE id = ?', [imgId]);
    await storage.remove(im.file);
    await audit(user, 'image.delete', id);
    return dto(await row(id));
  }
  async function moveImage(user, id, imgId, dir) {
    const list = await images(id); const i = list.findIndex(x => x.id === imgId);
    if (i < 0) throw new ApiError(404, 'not_found', 'Фото не найдено');
    const j = i + (dir < 0 ? -1 : 1); if (j < 0 || j >= list.length) return dto(await row(id));
    [list[i], list[j]] = [list[j], list[i]];
    for (let k = 0; k < list.length; k++) await db.run('UPDATE product_images SET sort=? WHERE id=?', [k, list[k].id]);
    return dto(await row(id));
  }

  /* ---------- публичный каталог ---------- */
  async function publicList() {
    const rows = await db.all("SELECT * FROM products WHERE status = 'published' ORDER BY type_id, price, id");
    const imgs = await db.all("SELECT i.* FROM product_images i JOIN products p ON p.id = i.product_id WHERE p.status = 'published' ORDER BY i.sort, i.created_at");
    const by = new Map(); for (const i of imgs) { if (!by.has(i.product_id)) by.set(i.product_id, []); by.get(i.product_id).push(i); }
    return rows.map(p => publicDto(p, by.get(p.id)));
  }

  async function stats() {
    const c = async (w) => N((await db.get(`SELECT ${COUNT} AS c FROM products ${w}`)).c);
    const byType = Object.fromEntries((await db.all(`SELECT type_id, ${COUNT} AS c FROM products GROUP BY type_id`)).map(r => [r.type_id, N(r.c)]));
    return { total: await c(''), published: await c("WHERE status='published'"), draft: await c("WHERE status='draft'"), review: await c("WHERE status='review'"),
      withModel: await c("WHERE model_status='ready'"), modelProblems: await c("WHERE model_status IN ('mismatch','failed')"), demo: await c("WHERE source='demo'"), byType };
  }

  /* ---------- демо‑набор (вставка пачками — быстро и для Postgres по HTTP) ---------- */
  async function seedDemo() {
    const t = now(), list = T.demoProducts(), B = 50;
    for (let i = 0; i < list.length; i += B) {
      const part = list.slice(i, i + B);
      const vals = part.map(() => "(?, 'demo', ?, ?, ?, ?, ?, 'RUB', ?, 'published', ?, ?, ?)").join(',');
      const args = part.flatMap(p => [p.id, p.typeId, p.formId, p.name, p.brand, p.price, JSON.stringify(p.dims), t, t, searchText(p.name, p.brand)]);
      await db.run(`INSERT INTO products (id,source,type_id,form_id,name,brand,price,currency,dims,status,created_at,updated_at,search) VALUES ${vals} ON CONFLICT (id) DO NOTHING`, args);
    }
  }
  async function purgeDemo(user) {
    const r = await db.run("DELETE FROM products WHERE source='demo'");
    await db.run('INSERT INTO audit_log (user_id,action,entity,entity_id,data,at) VALUES (?,?,?,?,?,?)', [user.id, 'demo.purge', 'product', null, JSON.stringify({ count: r.changes }), now()]);
    return r.changes;
  }

  /* Заполнить поле поиска у товаров, созданных до миграции v2 */
  async function backfillSearch() {
    const rows = await db.all("SELECT id, name, brand FROM products WHERE search = ''");
    for (const r of rows) await db.run('UPDATE products SET search = ? WHERE id = ?', [searchText(r.name, r.brand), r.id]);
    return rows.length;
  }

  return { backfillSearch, ApiError, row, dto, list, create, update, remove, transition, publishProblems, attachModel, deleteModel, fitDimsToModel, requestGeneration, attachImage, deleteImage, moveImage, publicList, stats, seedDemo, purgeDemo, LIMITS, CURRENCIES };
}

module.exports = { makeCatalog, ApiError, LIMITS };
