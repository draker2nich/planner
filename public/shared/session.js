/* =====================================================================
   Клиент сессии пользователя для всех страниц сайта и редактора.
   Токен: localStorage['planner.token'] (отдельно от admin.token админ‑панели).
   Если localStorage недоступен (приватный режим), токен живёт в памяти вкладки.
   События на window:
     'planner:session' — вход или выход (в этой или другой вкладке); detail = {user|null}
   ===================================================================== */
(function (root) {
  'use strict';
  const KEY = 'planner.token';
  let mem = null; let storageOk = true;
  try { const t = '__planner_probe'; localStorage.setItem(t, '1'); localStorage.removeItem(t); } catch { storageOk = false; }

  const read = () => { if (!storageOk) return mem; try { return localStorage.getItem(KEY); } catch { return mem; } };
  const write = (v) => { mem = v; if (!storageOk) return; try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {} };
  const emit = (user) => root.dispatchEvent(new CustomEvent('planner:session', { detail: { user } }));

  class ApiFail extends Error {
    constructor(status, code, message, details, retryAfter) { super(message); this.status = status; this.code = code; this.details = details; this.retryAfter = retryAfter; }
  }

  const Session = {
    storageOk,
    user: null,
    get token() { return read(); },
    ApiFail,

    /* Запрос к API. Ошибки — ApiFail: status 0 = нет сети. 401 при наличии токена → выход. */
    async api(method, path, body, opts = {}) {
      const headers = { Accept: 'application/json' };
      const tok = read();
      if (tok) headers.Authorization = 'Bearer ' + tok;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      let r;
      try {
        r = await fetch('/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: opts.signal, keepalive: !!opts.keepalive });
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        throw new ApiFail(0, 'network', 'Не удалось связаться с сервером. Проверьте интернет и попробуйте ещё раз');
      }
      let j = null; try { j = await r.json(); } catch {}
      if (!r.ok) {
        const err = (j && j.error) || {};
        if (r.status === 401 && tok && !opts.keep401) { Session.clear(); }
        throw new ApiFail(r.status, err.code || 'http_' + r.status, err.message || 'Ошибка сервера (' + r.status + ')', err.details, Number(r.headers.get('Retry-After')) || (err.details && err.details.retryAfter) || 0);
      }
      return j;
    },

    /* Текущий пользователь или null. Без токена — без запроса. Сеть → бросает ApiFail(0). */
    async me() {
      if (!read()) { Session.user = null; return null; }
      try { const r = await Session.api('GET', '/auth/me'); Session.user = r.user; return r.user; }
      catch (e) { if (e.status === 401) { Session.user = null; return null; } throw e; }
    },
    set(token, user) { write(token); Session.user = user; emit(user); },
    clear() { const had = !!read() || !!Session.user; write(null); Session.user = null; if (had) emit(null); },
    async logout() {
      try { if (read()) await Session.api('POST', '/auth/logout', undefined, { keep401: true }); } catch {}
      Session.clear();
    },
    initial(name) { const s = String(name || '').trim(); return (s ? s[0] : '?').toUpperCase(); },
  };

  /* Синхронизация вкладок: вход/выход в другой вкладке */
  root.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    if (!e.newValue) { Session.user = null; emit(null); }
    else Session.me().then(u => emit(u)).catch(() => {});
  });

  /* Тема: 'system' | 'light' | 'dark' — localStorage['planner.theme'], атрибут data-theme на <html> */
  Session.theme = {
    get() { try { const t = localStorage.getItem('planner.theme'); return t === 'light' || t === 'dark' ? t : 'system'; } catch { return 'system'; } },
    set(t) {
      try { t === 'system' ? localStorage.removeItem('planner.theme') : localStorage.setItem('planner.theme', t); } catch {}
      if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    },
  };

  root.Session = Session;
})(window);
