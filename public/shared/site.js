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
        .then(c => ({ registration: c.registration !== false, contactEmail: c.contactEmail || null, termsVersion: c.termsVersion || '' })));
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
  function changePassword() {
    modal('Сменить пароль', (dlg, close) => {
      const cur = h('input', { type: 'password', name: 'current', autocomplete: 'current-password', required: true });
      const nx = h('input', { type: 'password', name: 'next', autocomplete: 'new-password', minlength: '8', maxlength: '128', required: true });
      const err = h('div', { class: 'err', role: 'alert' });
      const ok = h('button', { type: 'submit', class: 'primary' }, 'Сменить пароль');
      const form = h('form', { class: 'sdlg-form', novalidate: true },
        h('label', { class: 'fld' }, h('span', {}, 'Текущий пароль'), cur),
        h('label', { class: 'fld' }, h('span', {}, 'Новый пароль'), nx, h('span', { class: 'desc' }, 'Не короче 8 символов. Остальные сеансы будут завершены.')),
        err, h('div', { class: 'sdlg-btns' }, h('button', { type: 'button', onclick: close }, 'Отмена'), ok));
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); err.textContent = '';
        const msg = root.Validation ? Validation.validatePassword(nx.value, Session.user && Session.user.email) : (nx.value.length < 8 ? 'Пароль — не короче 8 символов' : '');
        if (!cur.value) { err.textContent = 'Введите текущий пароль'; cur.focus(); return; }
        if (msg) { err.textContent = msg; nx.focus(); return; }
        ok.disabled = true; ok.textContent = 'Сохранение…';
        try { await Session.api('POST', '/auth/password', { current: cur.value, next: nx.value }); close(); Site.toast('Пароль изменён'); }
        catch (x) { err.textContent = x.message; ok.disabled = false; ok.textContent = 'Сменить пароль'; }
      });
      dlg.append(form); setTimeout(() => cur.focus(), 0);
    });
  }
  Site.changePassword = changePassword;

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
    extra.forEach(x => menu.append(item(x.icon, x.label, x.fn, x.cls, x.href)));
    menu.append(item('key', 'Сменить пароль', changePassword));
    if (user.role === 'admin') menu.append(item('shield', 'Админ‑панель', null, '', '/admin'));
    menu.append(h('hr'), item('logout', 'Выйти', async () => { await Session.logout(); Site.toast('Вы вышли из аккаунта'); }));
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
    const u = Site.user;
    acct.replaceChildren();
    if (mrow) mrow.replaceChildren();
    if (!u) {
      acct.append(h('a', { class: 'btn ghost hide-sm', href: '/login' }, 'Войти'));
      if (cfg.registration) acct.append(h('a', { class: 'btn primary hide-sm', href: '/register', 'data-ev': 'register_click' }, 'Регистрация'));
      if (mrow) { mrow.append(h('a', { class: 'btn', href: '/login' }, 'Войти')); if (cfg.registration) mrow.append(h('a', { class: 'btn primary', href: '/register' }, 'Регистрация')); }
    } else {
      acct.append(h('a', { class: 'btn primary hide-sm', href: '/editor' }, 'Открыть редактор'), accountMenu(u, [{ icon: 'edit', label: 'Мой проект', href: '/editor' }]));
      if (mrow) mrow.append(h('a', { class: 'btn primary', href: '/editor' }, 'Открыть редактор'));
    }
  }
  Site.refreshUser = async function () {
    try { Site.user = await Session.me(); } catch { Site.user = null; } // сеть: показываем гостя, токен не трогаем
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
    return Site.refreshUser();
  };

  root.Site = Site;
})(window);
