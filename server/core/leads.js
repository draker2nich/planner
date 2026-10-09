'use strict';
/* Заявки менеджеру: пользователь отправляет список товаров своего проекта (или варианта ИИ‑дизайнера) и контакт для связи.
   Цены и названия сервер берёт из каталога сам — присланным с клиента суммам не верит.
   Заявка хранит снимок списка на момент отправки: каталог и проект потом могут измениться.
   Корзины магазина у платформы нет (товар ведёт на страницу продавца), поэтому заявка — это путь «купить всё сразу». */
const crypto = require('node:crypto');
const { ApiError } = require('./catalog.js');

const LIM = { items: 200, qty: 99, name: 80, comment: 600, variant: 80, note: 1000 };
const PAGE = 50;
const likeEsc = (s) => String(s).replace(/[\\%_]/g, (c) => '\\' + c);
/* строка поиска без учёта регистра: имя, телефон (как введён и одними цифрами), почта, проект */
const searchText = (r) => `${r.name || ''} ${r.phone || ''} ${String(r.phone || '').replace(/\D/g, '')} ${r.email || ''} ${r.project_name || ''}`.toLowerCase().replace(/ё/g, 'е').trim();
const PRODUCT_ID = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,79}$/;
const now = () => new Date().toISOString();
const line = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const bad = (message, field) => new ApiError(422, 'validation', message, field ? { fields: { [field]: message } } : undefined);

function readLead(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('Некорректная заявка');
  const name = line(b.name, LIM.name);
  if (name.length < 2) throw bad('Укажите, как к вам обращаться', 'name');
  const phone = line(b.phone, 32);
  const digits = phone.replace(/\D/g, '');
  if (!/^[+\d][\d\s()\-]{5,30}$/.test(phone) || digits.length < 7 || digits.length > 15) throw bad('Укажите телефон с кодом, например +375 29 123‑45‑67', 'phone');
  if (!Array.isArray(b.items) || !b.items.length) throw bad('В заявке нет товаров: выберите товары вместо пустышек');
  if (b.items.length > LIM.items) throw bad('Слишком много позиций');
  const qty = new Map();
  for (const it of b.items) {
    if (!it || typeof it.productId !== 'string' || !PRODUCT_ID.test(it.productId)) throw bad('Некорректная позиция заявки');
    const n = Math.floor(Number(it.qty));
    if (!(n >= 1 && n <= LIM.qty)) throw bad('Некорректное количество');
    qty.set(it.productId, Math.min(LIM.qty, (qty.get(it.productId) || 0) + n));
  }
  return { name, phone, comment: line(b.comment, LIM.comment), variant: line(b.variant, LIM.variant), qty };
}

function makeLeads(db, catalog) {
  const dto = (r) => {
    let items = []; try { items = JSON.parse(r.items) || []; } catch {}
    return { id: r.id, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at, name: r.name, phone: r.phone, email: r.email, comment: r.comment, note: r.note || '',
      projectId: r.project_id, projectName: r.project_name, variant: r.variant, total: Number(r.total), currency: r.currency, items,
      user: r.user_id ? { id: r.user_id, email: r.user_email || r.email } : null };
  };
  /* заявка глазами её автора: без заметки менеджера и служебных полей */
  const own = (r) => { const d = dto(r); return { id: d.id, status: d.status, createdAt: d.createdAt, projectId: d.projectId, projectName: d.projectName, variant: d.variant, total: d.total, currency: d.currency, items: d.items }; };
  const one = (id) => db.get('SELECT l.*, u.email AS user_email FROM leads l LEFT JOIN users u ON u.id = l.user_id WHERE l.id=?', [String(id)]);
  return {
    /* project — строка проекта владельца (права уже проверены) */
    async create(user, project, body) {
      const v = readLead(body);
      const found = new Map((await catalog.publicByIds([...v.qty.keys()])).map((p) => [p.id, p]));
      const items = [];
      for (const [id, n] of v.qty) { const p = found.get(id); if (p) items.push({ productId: p.id, name: p.name, brand: p.brand, price: p.price, currency: p.currency, qty: n, url: /^https?:\/\//.test(p.url || '') ? p.url : '' }); }
      if (!items.length) throw bad('Товаров из заявки больше нет в каталоге');
      const currency = items[0].currency || '';
      /* итог — только по позициям в основной валюте заявки: суммы в разных валютах не складываются */
      const total = Math.round(items.filter((i) => i.currency === currency).reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100;
      const id = crypto.randomUUID(); const t = now();
      await db.run('INSERT INTO leads (id,user_id,project_id,project_name,variant,name,phone,email,comment,items,total,currency,status,created_at,updated_at,search) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [id, user.id, project.id, project.name, v.variant, v.name, v.phone, user.email, v.comment, JSON.stringify(items), total, currency, 'new', t, t, searchText({ name: v.name, phone: v.phone, email: user.email, project_name: project.name })]);
      return dto({ id, user_id: user.id, project_id: project.id, project_name: project.name, variant: v.variant, name: v.name, phone: v.phone, email: user.email, comment: v.comment, items: JSON.stringify(items), total, currency, status: 'new', created_at: t, updated_at: t });
    },
    /* Список для админ‑панели: по страницам, с фильтром по статусу и поиском по имени, телефону, почте и проекту */
    async list(q = {}) {
      const where = []; const args = [];
      if (['new', 'done'].includes(q.status)) { where.push('l.status = ?'); args.push(q.status); }
      const text = String(q.q || '').trim().slice(0, 100).toLowerCase().replace(/ё/g, 'е');
      if (text) { where.push("l.search LIKE ? ESCAPE '\\'"); args.push('%' + likeEsc(text) + '%'); }
      const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const size = Math.max(1, Math.min(200, Math.floor(Number(q.limit)) || PAGE));
      const total = Number((await db.get(`SELECT CAST(COUNT(*) AS INTEGER) AS c FROM leads l ${w}`, args)).c);
      const pages = Math.max(1, Math.ceil(total / size));
      const page = Math.min(pages, Math.max(1, parseInt(q.page, 10) || 1));
      const rows = await db.all(`SELECT l.*, u.email AS user_email FROM leads l LEFT JOIN users u ON u.id = l.user_id ${w} ORDER BY l.created_at DESC, l.id LIMIT ? OFFSET ?`, [...args, size, (page - 1) * size]);
      return { leads: rows.map(dto), fresh: await this.fresh(), total, page, pages, pageSize: size };
    },
    /* свои заявки пользователя — на странице аккаунта */
    async mine(user) {
      const rows = await db.all('SELECT * FROM leads WHERE user_id=? ORDER BY created_at DESC, id LIMIT 50', [user.id]);
      return { leads: rows.map(own) };
    },
    async setStatus(id, status) {
      if (!['new', 'done'].includes(status)) throw bad('Неизвестный статус');
      const r = await db.run('UPDATE leads SET status=?, updated_at=? WHERE id=?', [status, now(), String(id)]);
      if (!r.changes) throw new ApiError(404, 'not_found', 'Заявка не найдена');
      return dto(await one(id));
    },
    /* заметка менеджера: что обсудили, когда перезвонить. Пользователю не показывается. */
    async setNote(id, note) {
      const text = String(note == null ? '' : note).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, LIM.note);
      const r = await db.run('UPDATE leads SET note=?, updated_at=? WHERE id=?', [text, now(), String(id)]);
      if (!r.changes) throw new ApiError(404, 'not_found', 'Заявка не найдена');
      return dto(await one(id));
    },
    /* строка поиска у заявок, созданных до миграции v7 */
    async backfillSearch(limit = 1000000) {
      const rows = await db.all("SELECT id, name, phone, email, project_name FROM leads WHERE search = '' LIMIT ?", [limit + 1]);
      for (const r of rows.slice(0, limit)) await db.run('UPDATE leads SET search=? WHERE id=?', [searchText(r), r.id]);
      return { done: Math.min(rows.length, limit), left: Math.max(0, rows.length - limit) };
    },
    async fresh() { return Number((await db.get("SELECT CAST(COUNT(*) AS INTEGER) AS c FROM leads WHERE status='new'")).c); },
  };
}

module.exports = { makeLeads, readLead };
