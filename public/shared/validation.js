/* =====================================================================
   Общие правила проверки полей регистрации и входа.
   Один источник для браузера (auth.html) и сервера (server/core/app.js),
   как catalog-types.js: в браузере — глобальный объект Validation,
   на сервере — require(). Тексты ошибок одинаковы в обоих местах.
   ===================================================================== */
(function (root) {
  'use strict';
  const COMMON = (typeof module !== 'undefined' && module.exports) ? require('./common-passwords.js') : (root.COMMON_PASSWORDS || []);
  const COMMON_SET = new Set(COMMON);

  const TERMS_VERSION = '2026-10-01';
  const LIMITS = { nameMax: 60, emailMax: 254, emailLocalMax: 64, pwMin: 8, pwMax: 128, projectNameMax: 80 };
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const normName = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const normEmail = (s) => String(s == null ? '' : s).trim().toLowerCase();
  const normPassword = (s) => String(s == null ? '' : s).normalize('NFC');

  function validateName(raw) {
    const s = normName(raw);
    if (!s) return 'Введите имя';
    if (s.length > LIMITS.nameMax) return `Имя — не длиннее ${LIMITS.nameMax} символов`;
    if (/[\u0000-\u001f\u007f<>]/.test(s)) return 'Имя содержит недопустимые символы';
    if (!/\p{L}/u.test(s)) return 'Имя должно содержать хотя бы одну букву';
    return '';
  }
  function validateEmail(raw) {
    const s = normEmail(raw);
    if (!s) return 'Введите почту';
    if (s.length > LIMITS.emailMax || !EMAIL_RE.test(s) || s.split('@')[0].length > LIMITS.emailLocalMax) return 'Проверьте адрес почты: например, name@example.com';
    return '';
  }
  function validatePassword(raw, email) {
    const pw = normPassword(raw);
    if (!pw) return 'Введите пароль';
    if (pw.length < LIMITS.pwMin) return `Пароль — не короче ${LIMITS.pwMin} символов`;
    if (pw.length > LIMITS.pwMax) return `Пароль — не длиннее ${LIMITS.pwMax} символов`;
    const low = pw.toLowerCase();
    const em = normEmail(email);
    if (em && (low === em || low === em.split('@')[0])) return 'Пароль не должен совпадать с почтой';
    if (COMMON_SET.has(low)) return 'Этот пароль слишком распространён — придумайте другой';
    return '';
  }
  /* 0 — слабый, 1 — нормальный, 2 — хороший. Только подсказка, на отправку не влияет. */
  function passwordStrength(raw) {
    const pw = normPassword(raw);
    if (pw.length < LIMITS.pwMin || COMMON_SET.has(pw.toLowerCase())) return 0;
    const kinds = [/[a-zа-яё]/, /[A-ZА-ЯЁ]/, /\d/, /[^\p{L}\d]/u].filter(r => r.test(pw)).length;
    if (pw.length >= 14 || (pw.length >= 10 && kinds >= 3)) return 2;
    if (pw.length >= 10 || kinds >= 2) return 1;
    return 0;
  }
  /* Регистрация: {ok, fields:{name?,email?,password?,acceptTerms?}, values:{name,email,password,marketing}} */
  function validateRegistration(b) {
    b = b || {};
    const fields = {};
    const n = validateName(b.name); if (n) fields.name = n;
    const e = validateEmail(b.email); if (e) fields.email = e;
    const p = validatePassword(b.password, b.email); if (p) fields.password = p;
    if (b.acceptTerms !== true) fields.acceptTerms = 'Нужно принять условия использования и политику конфиденциальности';
    return {
      ok: !Object.keys(fields).length, fields,
      values: { name: normName(b.name), email: normEmail(b.email), password: normPassword(b.password), marketing: b.marketing === true },
    };
  }

  /* Подсказка опечатки в домене почты: 'anna@gmial.com' → 'anna@gmail.com' */
  const TYPOS = {
    'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.ru': 'gmail.com', 'gmaill.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com',
    'yandex.com': 'yandex.ru', 'yandeх.ru': 'yandex.ru', 'yadex.ru': 'yandex.ru', 'yandex.r': 'yandex.ru', 'yndex.ru': 'yandex.ru',
    'mail.ry': 'mail.ru', 'mail.ri': 'mail.ru', 'maill.ru': 'mail.ru', 'mial.ru': 'mail.ru', 'mail.r': 'mail.ru',
    'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com',
    'icloud.co': 'icloud.com', 'iclod.com': 'icloud.com', 'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com',
  };
  function emailTypo(raw) {
    const s = normEmail(raw); const i = s.lastIndexOf('@');
    if (i < 1) return null;
    const fix = TYPOS[s.slice(i + 1)];
    return fix ? s.slice(0, i + 1) + fix : null;
  }

  /* Параметр ?next=: только относительный путь своего сайта, иначе fallback */
  function safeNext(raw, fallback = '/editor') {
    const s = String(raw == null ? '' : raw);
    if (!s || s.length > 200) return fallback;
    if (!s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\')) return fallback;
    if (/[\u0000-\u001f\\]/.test(s)) return fallback;
    const firstSeg = s.split(/[/?#]/)[1] || '';
    if (firstSeg.includes(':')) return fallback;
    if (/^\/(login|register)(\/|\?|#|$)/.test(s)) return fallback;
    return s;
  }

  const api = { TERMS_VERSION, LIMITS, normName, normEmail, normPassword, validateName, validateEmail, validatePassword, passwordStrength, validateRegistration, emailTypo, safeNext };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Validation = api;
})(typeof self !== 'undefined' ? self : this);
