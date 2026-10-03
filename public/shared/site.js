/* =====================================================================
   Общее поведение страниц сайта: шапка с аккаунтом, меню‑бургер,
   переключатель темы в подвале, конфиг сервера, уведомления, смена пароля.
   Требует shared/icons.js и shared/session.js.
   Разметка: header.site-h (.acct, .burger, .mnav), footer.site-f (.theme-sw).
   ===================================================================== */
(function (root) {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  let cfgP = null;
  const Site = {
    /* GET /api/config один раз за страницу; без сервера — разумные значения по умолчанию */
    config() {
      return cfgP || (cfgP = fetch('/api/config', { headers: { Accept: 'application/json' } })
        .then(r => r.ok ? r.json() : {}).catch(() => ({}))
        .then(c => ({ registration: c.registration !== false, contactEmail: c.contactEmail || null, termsVersion: c.termsVersion || '',
          mail: c.mail === true, oauth: { google: !!(c.oauth && c.oauth.google), yandex: !!(c.oauth && c.oauth.yandex) }, requireVerifiedEmail: c.requireVerifiedEmail === true })));
    },
    toast(msg, err) {
      let box = $('#toasts'); if (!box) { box = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
      while (box.children.length >= 3) box.firstElementChild.remove();
      const t = h('div', { class: 'toast' + (err ? ' err' : ''), role: err ? 'alert' : 'status' }, ic(err ? 'alert' : 'check'), h('span', {}, msg));
      box.append(t); setTimeout(() => t.remove(), err ? 4500 : 2600);
    },
    user: undefined, // undefined — ещё не знаем; null — гость
  };

  /* ---------- модальное окно (смена пароля) ---------- */
  function modal(title, build) {
    const dlg = h('dialog', { class: 'card site-dlg', 'aria-labelledby': 'sdlgT' });
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.append(h('h2', { id: 'sdlgT' }, title));
    build(dlg, close);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
    document.body.append(dlg); dlg.showModal();
    return close;
  }
  Site.modal = modal;
  /* Смена пароля; у аккаунта без пароля (вход через Google или Яндекс) — «Задать пароль» без поля текущего */
  function changePassword(onDone) {
    const has = !Session.user || Session.user.hasPassword !== false;
    modal(has ? 'Сменить пароль' : 'Задать пароль', (dlg, close) => {
      const cur = h('input', { type: 'password', name: 'current', autocomplete: 'current-password', required: true });
      const nx = h('input', { type: 'password', name: 'next', autocomplete: 'new-password', minlength: '8', maxlength: '128', required: true });
      const err = h('div', { class: 'err', role: 'alert' });
      const label = has ? 'Сменить пароль' : 'Задать пароль';
      const ok = h('button', { type: 'submit', class: 'primary' }, label);
      const form = h('form', { class: 'sdlg-form', novalidate: true },
        has ? h('label', { class: 'fld' }, h('span', {}, 'Текущий пароль'), cur) : h('p', {}, 'Сейчас вы входите через Google или Яндекс. С паролем можно будет входить и по почте.'),
        h('label', { class: 'fld' }, h('span', {}, 'Новый пароль'), nx, h('span', { class: 'desc' }, has ? 'Не короче 8 символов. Остальные сеансы будут завершены.' : 'Не короче 8 символов.')),
        err, h('div', { class: 'sdlg-btns' }, h('button', { type: 'button', onclick: close }, 'Отмена'), ok));
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); err.textContent = '';
        const msg = root.Validation ? Validation.validatePassword(nx.value, Session.user && Session.user.email) : (nx.value.length < 8 ? 'Пароль — не короче 8 символов' : '');
        if (has && !cur.value) { err.textContent = 'Введите текущий пароль'; cur.focus(); return; }
        if (msg) { err.textContent = msg; nx.focus(); return; }
        ok.disabled = true; ok.textContent = 'Сохранение…';
        try {
          await Session.api('POST', '/auth/password', has ? { current: cur.value, next: nx.value } : { next: nx.value });
          if (Session.user) Session.user.hasPassword = true;
          close(); Site.toast(has ? 'Пароль изменён' : 'Пароль задан'); if (onDone) onDone();
        } catch (x) { err.textContent = x.message; ok.disabled = false; ok.textContent = label; }
      });
      dlg.append(form); setTimeout(() => (has ? cur : nx).focus(), 0);
    });
  }
  Site.changePassword = changePassword;

  /* Подтверждение действия. danger — красная кнопка для необратимых действий. */
  Site.confirm = function (title, text, { ok = 'Да', danger = false } = {}) {
    return new Promise((res) => {
      let done = false; const finish = (v, close) => { if (done) return; done = true; close(); res(v); };
      modal(title, (dlg, close) => {
        const yes = h('button', { type: 'button', class: danger ? 'destructive' : 'primary', onclick: () => finish(true, close) }, ok);
        dlg.append(h('p', {}, text), h('div', { class: 'sdlg-btns' }, h('button', { type: 'button', onclick: () => finish(false, close) }, 'Отмена'), yes));
        dlg.addEventListener('close', () => finish(false, () => {}));
        setTimeout(() => yes.focus(), 0);
      });
    });
  };
  /* Диалог с одним текстовым полем. submit(value) → строка ошибки или '' / undefined при успехе. */
  Site.prompt = function (title, { label, value = '', ok = 'Сохранить', maxlength = 80, placeholder = '', submit }) {
    modal(title, (dlg, close) => {
      const inp = h('input', { type: 'text', name: 'value', maxlength: String(maxlength), autocomplete: 'off', placeholder: placeholder || null, required: true }); inp.value = value;
      const err = h('div', { class: 'err', role: 'alert' });
      const btn = h('button', { type: 'submit', class: 'primary' }, ok);
      const form = h('form', { class: 'sdlg-form', novalidate: true }, h('label', { class: 'fld' }, h('span', {}, label), inp), err,
        h('div', { class: 'sdlg-btns' }, h('button', { type: 'button', onclick: close }, 'Отмена'), btn));
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); err.textContent = ''; btn.disabled = true;
        let msg = '';
        try { msg = await submit(inp.value); } catch (x) { msg = x.message || 'Не удалось сохранить'; }
        if (msg) { err.textContent = msg; btn.disabled = false; inp.focus(); return; }
        close();
      });
      dlg.append(form); setTimeout(() => { inp.focus(); inp.select(); }, 0);
    });
  };

  /* Напоминание о подтверждении почты (ТЗ этапа 2, 3.3). Возвращает узел или null. */
  Site.verifyBanner = async function () {
    const u = Site.user; const cfg = await Site.config();
    if (!u || u.emailVerified || u.role === 'admin' || !cfg.mail) return null;
    const btn = h('button', { type: 'button', class: 'sm' }, 'Отправить письмо ещё раз');
    const note = h('span', { class: 'vb-note', role: 'status' });
    const lock = (sec) => {
      const until = Date.now() + sec * 1000;
      const tick = () => { const left = Math.ceil((until - Date.now()) / 1000); if (left <= 0) { btn.disabled = false; btn.textContent = 'Отправить письмо ещё раз'; return; } btn.disabled = true; btn.textContent = `Повторить через ${left >= 60 ? Math.ceil(left / 60) + ' мин' : left + ' с'}`; setTimeout(tick, 1000); };
      tick();
    };
    btn.addEventListener('click', async () => {
      btn.disabled = true; note.textContent = '';
      try {
        const r = await Session.api('POST', '/auth/verify/resend');
        if (r.already) { Site.user.emailVerified = true; location.reload(); return; }
        note.textContent = 'Письмо отправлено'; lock(60);
      } catch (x) {
        if (x.status === 429) { note.textContent = ''; lock(x.retryAfter || 60); }
        else { note.textContent = x.message; btn.disabled = false; }
      }
    });
    return h('div', { class: 'callout warn vbanner' }, ic('mail'),
      h('div', { class: 'vb-text' }, h('b', {}, 'Подтвердите почту'), h('span', {}, ` Мы отправили письмо на ${u.email}. Без подтверждения мы не сможем помочь восстановить доступ.`)),
      h('div', { class: 'vb-act' }, btn, note));
  };
  /* Страницы только для вошедших: гость уходит на вход и возвращается обратно.
     Нет связи при сохранённом входе — не выгоняем на вход, а зовём onOffline (страница покажет «нет связи»). */
  Site.toLogin = () => location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search));
  Site.requireUser = async function (onOffline) {
    const u = await Site.init();
    if (u) {
      root.addEventListener('planner:session', (e) => { if (!e.detail.user && !Site.leaving) Site.toLogin(); }); // выход в этой или другой вкладке
      return u;
    }
    if (Site.offline && Session.token && onOffline) { onOffline(); return null; }
    Site.toLogin(); return null;
  };
  /* Состояние «не удалось загрузить» с кнопкой повтора */
  Site.errorState = function (text, retry) {
    return h('div', { class: 'empty-state', role: 'alert' }, ic('alert'), h('b', {}, 'Не удалось загрузить'), h('span', {}, text),
      h('button', { type: 'button', onclick: retry || (() => location.reload()) }, ic('refresh'), 'Повторить'));
  };
  /* Склонение: plural(3, ['стена', 'стены', 'стен']) → «3 стены» */
  Site.plural = function (n, forms) {
    const a = Math.abs(n) % 100, b = a % 10;
    return n + '\u00a0' + (a > 10 && a < 20 ? forms[2] : b === 1 ? forms[0] : b >= 2 && b <= 4 ? forms[1] : forms[2]);
  };
  /* «сегодня в 14:05», «вчера в 09:10», «3 марта», «3 марта 2025» */
  Site.when = function (iso) {
    const d = new Date(iso); if (isNaN(d)) return '';
    const now = new Date(); const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 864e5);
    const hm = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(d);
    if (diff === 0) return 'сегодня в ' + hm;
    if (diff === 1) return 'вчера в ' + hm;
    return new Intl.DateTimeFormat('ru', d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  };

  /* ---------- меню аккаунта ---------- */
  function accountMenu(user, extra = []) {
    const wrap = h('div', { style: 'position:relative' });
    const btn = h('button', { type: 'button', class: 'ava', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Аккаунт: ' + (user.name || user.email) }, Session.initial(user.name || user.email));
    const menu = h('div', { class: 'dmenu amenu', role: 'menu', hidden: true });
    const item = (icon, label, fn, cls, href) => {
      const el = href ? h('a', { class: 'mi' + (cls ? ' ' + cls : ''), role: 'menuitem', href }, ic(icon), label) : h('button', { type: 'button', class: 'mi' + (cls ? ' ' + cls : ''), role: 'menuitem' }, ic(icon), label);
      if (fn) el.addEventListener('click', () => { setOpen(false); fn(); });
      return el;
    };
    menu.append(h('div', { class: 'who' }, h('b', {}, user.name || 'Без имени'), h('span', {}, user.email)), h('hr'));
    menu.append(item('folder', 'Мои проекты', null, '', '/projects'), item('user', 'Аккаунт', null, '', '/account'));
    extra.forEach(x => menu.append(item(x.icon, x.label, x.fn, x.cls, x.href)));
    if (user.emailVerified === false && user.role !== 'admin' && Site.mailOn) menu.append(item('mail', 'Подтвердить почту', null, '', '/account'));
    if (user.role === 'admin') menu.append(item('shield', 'Админ‑панель', null, '', '/admin'));
    menu.append(h('hr'), item('logout', 'Выйти', async () => {
      if (Session.hasUnsyncedProject() && !(await Site.confirm('Изменения не сохранены', 'Последние изменения проекта не дошли до аккаунта. Откройте редактор, чтобы они сохранились, или выйдите без них.', { ok: 'Выйти без сохранения', danger: true }))) return;
      await Session.logout(); Site.toast('Вы вышли из аккаунта');
    }));
    function setOpen(o) {
      menu.hidden = !o; btn.setAttribute('aria-expanded', String(o));
      if (o) { const f = menu.querySelector('.mi'); if (f) f.focus(); }
    }
    btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.hidden); });
    document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !wrap.contains(e.target)) setOpen(false); });
    menu.addEventListener('keydown', (e) => {
      const its = [...menu.querySelectorAll('.mi')]; const i = its.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btn.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); (its[i + 1] || its[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (its[i - 1] || its[its.length - 1]).focus(); }
    });
    wrap.append(btn, menu);
    return wrap;
  }
  Site.accountMenu = accountMenu;

  /* ---------- шапка сайта ---------- */
  async function renderAccount() {
    const acct = $('.site-h .acct'); if (!acct) return;
    const mrow = $('.mnav .row');
    const cfg = await Site.config();
    Site.mailOn = cfg.mail;
    const u = Site.user;
    acct.replaceChildren();
    if (mrow) mrow.replaceChildren();
    if (!u) {
      acct.append(h('a', { class: 'btn ghost hide-sm', href: '/login' }, 'Войти'));
      if (cfg.registration) acct.append(h('a', { class: 'btn primary hide-sm', href: '/register', 'data-ev': 'register_click' }, 'Регистрация'));
      if (mrow) { mrow.append(h('a', { class: 'btn', href: '/login' }, 'Войти')); if (cfg.registration) mrow.append(h('a', { class: 'btn primary', href: '/register' }, 'Регистрация')); }
    } else {
      const here = location.pathname.replace(/\/+$/, '');
      if (here !== '/projects') acct.append(h('a', { class: 'btn primary hide-sm', href: '/projects' }, 'Мои проекты'));
      acct.append(accountMenu(u, [{ icon: 'edit', label: 'Редактор', href: '/editor' }]));
      if (mrow) mrow.append(h('a', { class: 'btn primary', href: '/projects' }, 'Мои проекты'), h('a', { class: 'btn', href: '/account' }, 'Аккаунт'));
    }
  }
  Site.refreshUser = async function () {
    Site.offline = false;
    try { Site.user = await Session.me(); } catch { Site.user = null; Site.offline = true; } // сеть: показываем гостя, токен не трогаем
    renderAccount();
    root.dispatchEvent(new CustomEvent('site:user', { detail: { user: Site.user } }));
    return Site.user;
  };

  function initBurger() {
    const b = $('.burger'), nav = $('.mnav'); if (!b || !nav) return;
    const set = (o) => {
      nav.hidden = !o; b.setAttribute('aria-expanded', String(o)); b.replaceChildren(ic(o ? 'x' : 'menu'));
      b.setAttribute('aria-label', o ? 'Закрыть меню' : 'Открыть меню');
      if (o) { const f = nav.querySelector('a'); if (f) f.focus(); }
    };
    b.addEventListener('click', () => set(nav.hidden));
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
    document.addEventListener('keydown', (e) => {
      if (nav.hidden) return;
      if (e.key === 'Escape') { set(false); b.focus(); }
      if (e.key === 'Tab') { // ловушка фокуса: кнопка + ссылки меню
        const items = [b, ...nav.querySelectorAll('a')]; const i = items.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
        else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
      }
    });
    document.addEventListener('pointerdown', (e) => { if (!nav.hidden && !nav.contains(e.target) && !b.contains(e.target)) set(false); });
    matchMedia('(min-width:900px)').addEventListener('change', (m) => { if (m.matches) set(false); });
  }

  function initTheme() {
    const sw = $('.theme-sw'); if (!sw) return;
    const opts = [['system', 'monitor', 'Системная'], ['light', 'sun', 'Светлая'], ['dark', 'moon', 'Тёмная']];
    const paint = () => { const cur = Session.theme.get(); [...sw.children].forEach((b, i) => { const on = opts[i][0] === cur; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); };
    opts.forEach(([v, icon, label]) => sw.append(h('button', { type: 'button', title: label, 'aria-label': 'Тема: ' + label, onclick: () => { Session.theme.set(v); paint(); } }, ic(icon), h('span', { class: 'lbl-t' }, label))));
    paint();
  }

  Site.init = function () {
    initBurger(); initTheme();
    const y = $('#year'); if (y) y.textContent = String(new Date().getFullYear());
    root.addEventListener('planner:session', () => Site.refreshUser());
    try { const f = sessionStorage.getItem('planner.flash'); if (f) { sessionStorage.removeItem('planner.flash'); Site.toast(f); } } catch {}
    return Site.refreshUser();
  };

  root.Site = Site;
})(window);
