'use strict';
/* Отправка писем (ТЗ этапа 2, раздел 2). Провайдер выбирается по заданному ключу:
     RESEND_API_KEY        → Resend   (POST https://api.resend.com/emails)
     POSTMARK_SERVER_TOKEN → Postmark (POST https://api.postmarkapp.com/email)
     нет ключа, локально   → file: письмо пишется в <data>/outbox/*.json, ссылка — в консоль
     нет ключа, Vercel или NODE_ENV=production → off: почтовые функции выключены, /api/config отдаёт mail:false
   Для resend и postmark обязателен MAIL_FROM — иначе режим off (не шлём письма с чужого домена).
   SDK не используются — только fetch. */
const fs = require('node:fs');
const path = require('node:path');

const BRAND = 'furnitech';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* a***@example.com — для логов и экранов, где адрес нельзя показывать целиком */
function maskEmail(email) {
  const s = String(email || ''); const i = s.lastIndexOf('@');
  if (i < 1) return '***';
  return s[0] + '***' + s.slice(i);
}

/* Базовый адрес сайта для ссылок в письмах и адресов возврата. Заголовок Host не используется никогда. */
function baseUrl(ctx) {
  const env = ctx.env || {};
  const explicit = String(env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(explicit)) return explicit;
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return 'https://' + String(env.VERCEL_PROJECT_PRODUCTION_URL).replace(/\/+$/, '');
  if (env.VERCEL_URL) return 'https://' + String(env.VERCEL_URL).replace(/\/+$/, '');
  return 'http://localhost:' + (Number(env.PORT) || 8080);
}

/* ---------- шаблоны ---------- */
const TEMPLATES = {
  verify: ({ link }) => ({
    subject: `Подтвердите почту — ${BRAND}`,
    lead: 'Подтвердите адрес почты, чтобы мы могли помочь восстановить доступ к аккаунту.',
    button: 'Подтвердить почту', link,
    note: 'Ссылка действует 48 часов. Если вы не регистрировались в furnitech — просто не открывайте ссылку.',
  }),
  reset: ({ link }) => ({
    subject: `Сброс пароля — ${BRAND}`,
    lead: 'Мы получили запрос на сброс пароля. Нажмите кнопку и задайте новый пароль.',
    button: 'Задать новый пароль', link,
    note: 'Ссылка действует 1 час и сработает один раз. Если это были не вы — ничего не делайте: пароль останется прежним.',
  }),
  password_changed: () => ({
    subject: `Пароль изменён — ${BRAND}`,
    lead: 'Пароль вашего аккаунта только что был изменён.',
    note: 'Если это были не вы — немедленно сбросьте пароль на странице входа («Забыли пароль?») и напишите нам.',
  }),
  account_deleted: () => ({
    subject: `Аккаунт удалён — ${BRAND}`,
    lead: 'Ваш аккаунт и все проекты в нём удалены. Восстановить их нельзя.',
    note: 'Если хотите вернуться — зарегистрируйтесь заново с той же почтой.',
  }),
  /* письмо менеджеру (CONTACT_EMAIL) о новой заявке; list — строки списка товаров */
  lead: ({ lead, link }) => ({
    subject: `Новая заявка: ${lead.name}, ${lead.phone} — ${BRAND}`,
    lead: `Заявка по проекту «${lead.projectName}»${lead.variant ? ` (${lead.variant})` : ''}. Контакт: ${lead.name}, ${lead.phone}, ${lead.email}.${lead.comment ? ` Комментарий: ${lead.comment}` : ''}`,
    list: lead.items.map((i) => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''} — ${Math.round(i.price * i.qty).toLocaleString('ru-RU')} ${i.currency}`),
    button: 'Открыть заявки', link,
    note: `Итого: ${Math.round(lead.total).toLocaleString('ru-RU')} ${lead.currency}. Позиций: ${lead.items.length}.`,
  }),
  /* подтверждение пользователю: заявка принята */
  lead_received: ({ lead, link }) => ({
    subject: `Заявка принята — ${BRAND}`,
    lead: `Мы получили вашу заявку по проекту «${lead.projectName}»${lead.variant ? ` (${lead.variant})` : ''}. Менеджер свяжется с вами по телефону ${lead.phone}.`,
    list: lead.items.map((i) => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''} — ${Math.round(i.price * i.qty).toLocaleString('ru-RU')} ${i.currency}`),
    button: 'Мои заявки', link,
    note: `Итого: ${Math.round(lead.total).toLocaleString('ru-RU')} ${lead.currency}. Цены — на момент отправки; точную стоимость и наличие подтвердит менеджер.`,
  }),
  blocked: ({ reason }) => ({
    subject: `Аккаунт заблокирован — ${BRAND}`,
    lead: 'Ваш аккаунт заблокирован администратором. Проекты сохранены, но вход недоступен.',
    note: reason ? `Причина: ${reason}` : 'Если вы считаете, что это ошибка, напишите нам.',
  }),
};

function render(kind, user, data, contact) {
  const make = TEMPLATES[kind];
  if (!make) throw new Error('Неизвестный вид письма: ' + kind);
  const t = make(data || {});
  const hello = user && user.name ? `Здравствуйте, ${user.name}!` : 'Здравствуйте!';
  const foot = contact ? `Вопросы — ${contact}` : '';
  const list = Array.isArray(t.list) ? t.list.slice(0, 200) : [];
  const text = [hello, '', t.lead, list.length ? '\n' + list.map((x) => '• ' + x).join('\n') : '', t.link ? `\n${t.button}: ${t.link}\n` : '', t.note, '', '— ' + BRAND, foot].filter((x) => x !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  const btn = t.link ? `<p style="margin:24px 0"><a href="${esc(t.link)}" style="display:inline-block;background:#18181b;color:#fafafa;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${esc(t.button)}</a></p><p style="margin:0 0 16px;font-size:13px;color:#71717a">Если кнопка не работает, скопируйте ссылку в браузер:<br><span style="word-break:break-all">${esc(t.link)}</span></p>` : '';
  const html = `<!doctype html><html lang="ru"><body style="margin:0;padding:24px;background:#fafafa;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#09090b"><div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:14px;padding:28px"><p style="margin:0 0 20px;font-weight:700;font-size:18px;letter-spacing:-.02em">furni<span style="color:#71717a;font-weight:500">tech</span></p><p style="margin:0 0 12px;font-size:16px">${esc(hello)}</p><p style="margin:0 0 12px;font-size:16px;line-height:24px">${esc(t.lead)}</p>${list.length ? `<ul style="margin:0 0 12px;padding-left:20px;font-size:14px;line-height:22px">${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${btn}<p style="margin:0;font-size:14px;line-height:21px;color:#52525b">${esc(t.note)}</p></div>${foot ? `<p style="max-width:480px;margin:16px auto 0;font-size:13px;color:#71717a;text-align:center">${esc(foot)}</p>` : ''}</body></html>`;
  return { subject: t.subject, text, html, link: t.link || null };
}

function makeMailer(ctx) {
  const env = ctx.env || {};
  const from = String(env.MAIL_FROM || '').trim();
  const contact = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(env.CONTACT_EMAIL || '').trim()) ? String(env.CONTACT_EMAIL).trim() : '';
  let mode = 'off';
  if (String(env.MAIL_MODE || '').trim() === 'off') mode = 'off';
  else if (env.RESEND_API_KEY && from) mode = 'resend';
  else if (env.POSTMARK_SERVER_TOKEN && from) mode = 'postmark';
  else if (!ctx.onVercel && ctx.dataDir && String(env.NODE_ENV || '').trim() !== 'production') mode = 'file'; // на боевом сервере письма в файл не пишем
  const doFetch = ctx.fetch || globalThis.fetch;

  async function post(url, headers, body) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 5000);
    try {
      const r = await doFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
      if (!r.ok) { let detail = ''; try { detail = (await r.text()).slice(0, 300); } catch {} throw new Error(`HTTP ${r.status} ${detail}`); }
    } finally { clearTimeout(timer); }
  }

  return {
    mode,
    enabled: mode !== 'off',
    /* Бросает ошибку при сбое — вызывающий решает, критично ли это (см. sendQuiet). */
    async send(kind, user, data) {
      if (mode === 'off') throw new Error('mail_disabled');
      const m = render(kind, user, data, contact);
      if (mode === 'resend') {
        await post('https://api.resend.com/emails', { Authorization: 'Bearer ' + env.RESEND_API_KEY }, { from, to: [user.email], subject: m.subject, text: m.text, html: m.html });
      } else if (mode === 'postmark') {
        await post('https://api.postmarkapp.com/email', { 'X-Postmark-Server-Token': env.POSTMARK_SERVER_TOKEN }, { From: from, To: user.email, Subject: m.subject, TextBody: m.text, HtmlBody: m.html, MessageStream: 'outbound' });
      } else {
        const dir = path.join(ctx.dataDir, 'outbox'); fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${kind}-${Math.random().toString(36).slice(2, 7)}.json`);
        fs.writeFileSync(file, JSON.stringify({ kind, to: user.email, subject: m.subject, link: m.link, text: m.text, html: m.html, at: new Date().toISOString() }, null, 2));
        if (env.MAIL_QUIET !== '1') console.log(`Письмо «${m.subject}» для ${user.email}${m.link ? ': ' + m.link : ''}`);
      }
      return true;
    },
    /* Отправка, сбой которой не должен ломать основное действие: ошибка только в лог, без адреса целиком */
    async sendQuiet(kind, user, data) {
      if (mode === 'off') return false;
      try { await this.send(kind, user, data); return true; }
      catch (e) { console.error(`Не удалось отправить письмо ${kind} для ${maskEmail(user.email)}: ${e.message}`); return false; }
    },
  };
}

module.exports = { makeMailer, baseUrl, maskEmail, render };
