/* =========================================================================
   Редактор в аккаунте (ТЗ, разделы 7 и 11). Подключается после основного скрипта editor.html
   и пользуется его глобальными функциями: P, D, derive, save, render, dialog, confirmDlg, h, ic, toast…
   Режимы:
     guest    — как раньше: проект только в localStorage;
     account  — локальная копия + синхронизация с /api/projects (PUT с проверкой версии);
     detached — пользователь вошёл, но решил оставить локальный проект отдельно (диалог 7.3, «Отмена»).
   ========================================================================= */
'use strict';
(function () {
  const LS = { id: 'roomEditor.projectId', rev: 'roomEditor.projectRev', dirty: 'roomEditor.dirty', backup: 'roomEditor.project.backup', hint: 'planner.guestHintDismissed' };
  const SKIP = ['viewport', 'panelCollapsed']; // вид плана не синхронизируем — иначе прокрутка плодит версии
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, String(v)); } catch {} };
  const hhmm = (d) => new Date(d || Date.now()).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  const when = (iso) => { const d = new Date(iso); const today = new Date().toDateString() === d.toDateString(); return today ? 'сегодня в ' + hhmm(d) : d.toLocaleString('ru', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }); };

  const Sync = { mode: 'guest', user: null, id: null, rev: 0, lastKey: null, inflight: false, again: false, timer: null, retryStep: 0, state: 'idle', edited: false, ready: false };
  window.EditorSync = Sync; // для отладки и тестов

  /* ---------- стили элементов аккаунта ---------- */
  document.head.append(h('style', {}, `
#acctBox{display:inline-flex;align-items:center;gap:6px;flex:none}
#acctBox .ava{width:32px;height:32px;padding:0;border-radius:50%;background:var(--muted);border:1px solid var(--border);box-shadow:none;font-weight:600;font-size:13px}
#acctBox .ava:hover{background:var(--accent)}
.lbtn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;border-radius:var(--radius-md);font-size:13px;font-weight:500;text-decoration:none;color:var(--foreground);border:1px solid transparent;white-space:nowrap;touch-action:manipulation;transition:background-color .15s,color .15s}
.lbtn:hover{background:var(--accent)}
.lbtn.primary{background:var(--primary);color:var(--primary-foreground)}
.lbtn.primary:hover{background:color-mix(in srgb,var(--primary) 90%,var(--background))}
.lbtn:focus-visible{box-shadow:0 0 0 3px color-mix(in srgb,var(--ring) 50%,transparent)}
a.mi{text-decoration:none}
header .save{font-variant-numeric:tabular-nums}
#acctMenu{position:absolute;right:12px;top:52px;min-width:240px;z-index:40}
#acctMenu .who{padding:8px 8px 6px;font-size:14px;line-height:1.35}
#acctMenu .who b{display:block;font-weight:600;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#acctMenu .who span{display:block;color:var(--muted-foreground);font-size:13px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
header .save .ic{width:14px;height:14px;vertical-align:-2px;margin-right:4px}
header .save.warn{color:var(--warning)}
#guestHint{position:absolute;left:calc(var(--gap) + var(--safe-left));bottom:calc(52px + var(--safe-bottom));z-index:6;display:flex;align-items:center;gap:10px;max-width:calc(100% - 120px);padding:8px 8px 8px 14px;font-size:13px;
  background:var(--popover);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-md);animation:pop-in .15s var(--ease)}
#guestHint .sp{flex:1}
#guestHint button,#guestHint .lbtn{height:30px;font-size:13px;padding:0 10px}
#guestHint .x{width:30px;padding:0;border:none;background:transparent;box-shadow:none;color:var(--muted-foreground)}
@media (max-width:640px){#guestHint{left:12px;right:12px;max-width:none;bottom:calc(84px + var(--safe-bottom));flex-wrap:wrap}}
.res-save{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.photo-note{font-size:13px;color:var(--muted-foreground);margin:6px 0 10px;display:flex;gap:6px;align-items:center}
`));

  /* ---------- индикатор сохранения (ТЗ 11.2) ---------- */
  function ind(state, extra) {
    Sync.state = state;
    const el = document.getElementById('saveInd'); if (!el) return;
    el.classList.toggle('warn', state === 'offline' || state === 'conflict');
    const t = {
      guest: 'В браузере ' + hhmm(),
      saving: 'Сохранение…',
      saved: null,
      offline: 'Нет связи — сохранено в браузере',
      conflict: 'Есть изменения с другого устройства',
      loading: 'Загрузка…',
      error: extra || 'Не сохраняется',
    }[state];
    if (state === 'saved') { el.replaceChildren(ic('cloud-check'), 'Сохранено ' + hhmm()); el.title = 'Сохранено в аккаунте'; return; }
    el.textContent = t; el.title = state === 'guest' ? 'Проект хранится только в этом браузере' : '';
  }
  ICONS['cloud-check'] = '<path d="M7 18a5 5 0 0 1-.6-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/><path d="M9.5 13l2 2 3.5-4"/>';

  /* ---------- что отправляем на сервер ---------- */
  function payload() { const o = {}; for (const k in P) if (!SKIP.includes(k)) o[k] = P[k]; return o; }
  const key = () => JSON.stringify(payload());

  /* Хук основного скрипта: вызывается после каждого локального сохранения */
  window.afterLocalSave = function (ok) {
    document.title = (P.name || 'Новый проект') + ' — furnitech';
    maybeGuestHint();
    if (Sync.mode !== 'account') { ind(ok ? 'guest' : 'error'); return; }
    const k = key();
    if (k === Sync.lastKey) return; // изменился только вид плана
    if (Sync.ready) Sync.edited = true;
    lsSet(LS.dirty, '1');
    if (Sync.state !== 'offline' && Sync.state !== 'conflict') ind('saving');
    schedule(1500);
  };

  function schedule(ms) { clearTimeout(Sync.timer); Sync.timer = setTimeout(push, ms); }

  /* ---------- отправка (ТЗ 11.3) ---------- */
  const BACKOFF = [2, 5, 15, 30];
  async function push() {
    if (Sync.mode !== 'account' || !Sync.id) return;
    if (Sync.state === 'conflict') return;
    if (Sync.inflight) { Sync.again = true; return; }
    const k = key();
    if (k === Sync.lastKey) { lsSet(LS.dirty, null); ind('saved'); return; }
    Sync.inflight = true; Sync.again = false;
    try {
      const r = await Session.api('PUT', '/projects/' + Sync.id, { name: P.name, data: JSON.parse(k), rev: Sync.rev });
      Sync.rev = r.rev; lsSet(LS.rev, r.rev); Sync.lastKey = k; Sync.retryStep = 0;
      if (key() === k) { lsSet(LS.dirty, null); ind('saved'); } else Sync.again = true;
    } catch (e) {
      if (e.status === 409 && e.code === 'conflict') { ind('conflict'); Sync.inflight = false; conflictDialog(e.details); return; }
      if (e.status === 401) { Sync.inflight = false; toGuest(true); toast('Сессия истекла — войдите, чтобы сохранять в аккаунт', true); return; }
      if (e.status === 404) { Sync.inflight = false; Sync.id = null; lsSet(LS.id, null); await bindNew(); return; }
      if (e.status === 0 || e.status >= 500 || e.status === 429) {
        ind('offline');
        const sec = e.status === 429 ? (e.retryAfter || 30) : BACKOFF[Math.min(Sync.retryStep++, BACKOFF.length - 1)];
        Sync.inflight = false; schedule(sec * 1000); return;
      }
      ind('error', e.message); // 413, 422 — показываем причину, не повторяем
    }
    Sync.inflight = false;
    if (Sync.again) schedule(300);
  }
  window.addEventListener('online', () => { if (Sync.mode === 'account' && lsGet(LS.dirty)) schedule(200); });

  /* ---------- загрузка проекта в редактор ---------- */
  function loadIntoEditor(data, meta) {
    const keepView = P && P.viewport && Sync.id === meta.id ? P.viewport : null;
    const p = normalizeProject(Object.assign({}, data));
    if (keepView) p.viewport = keepView;
    if (meta.name) p.name = meta.name;
    P = p; D = derive(P); E.sel = null; E.mode = 'idle'; E.tool = 'select'; E.propsOpen = false;
    if (P.mode === 'furniture' && !P.closed) P.mode = 'walls';
    hist = []; hi = -1; snapshot();
    $('#projName').value = P.name; $('#unitSel').value = P.unit;
    Sync.id = meta.id; Sync.rev = meta.rev; lsSet(LS.id, meta.id); lsSet(LS.rev, meta.rev); lsSet(LS.dirty, null);
    Sync.lastKey = key();
    try { localStorage.setItem('roomEditor.project', JSON.stringify(P)); } catch {}
    const res = $('#result'); if (res) { res.hidden = true; document.body.classList.remove('res'); }
    updateTools(); updateModeUI(); if (P.mode === 'furniture') buildCatalog();
    if (keepView) render(); else fitRoom();
    if (P.status === 'submitted' && P.brief) showResult();
    document.title = (P.name || 'Новый проект') + ' — furnitech';
    ind('saved');
  }
  function backupLocal() { try { localStorage.setItem(LS.backup, JSON.stringify(P)); } catch {} }

  /* Создать в аккаунте проект из текущего локального */
  async function bindNew() {
    try {
      const r = await Session.api('POST', '/projects', { name: P.name, data: payload() });
      Sync.id = r.id; Sync.rev = r.rev; lsSet(LS.id, r.id); lsSet(LS.rev, r.rev); lsSet(LS.dirty, null);
      Sync.lastKey = key(); ind('saved');
      if (key() !== Sync.lastKey) schedule(300);
    } catch (e) {
      if (e.status === 0 || e.status >= 500) { ind('offline'); setTimeout(() => { if (!Sync.id && Sync.mode === 'account') bindNew(); }, 15000); }
      else ind('error', e.message);
    }
  }

  /* ---------- диалоги ---------- */
  function conflictDialog(det) {
    dialog((box, api) => {
      box.append(h('h3', {}, 'Проект изменили на другом устройстве'),
        h('div', { class: 'hint' }, `В аккаунте есть более новая версия${det && det.updatedAt ? ' (' + when(det.updatedAt) + ')' : ''}. Какую оставить?`),
        h('div', { class: 'hint' }, 'Если загрузить ту версию, ваша текущая сохранится резервной копией в этом браузере.'));
      api.buttons = [
        { label: 'Оставить мою', onClick: (a) => a.close('mine') },
        { label: 'Загрузить ту версию', primary: true, onClick: (a) => a.close('theirs') },
      ];
    }).then(async (choice) => {
      try {
        const cur = await Session.api('GET', '/projects/' + Sync.id);
        if (choice === 'theirs') { backupLocal(); loadIntoEditor(cur.data, cur); toast('Загружена версия из аккаунта'); }
        else { Sync.rev = cur.rev; lsSet(LS.rev, cur.rev); Sync.lastKey = null; ind('saving'); Sync.state = 'saving'; push(); }
      } catch (e) { ind('offline'); toast(e.message, true); Sync.state = 'idle'; schedule(5000); }
    });
  }
  /* ТЗ 7.3: в браузере свой проект, а в аккаунте уже есть проекты */
  function chooseDialog(latest) {
    return dialog((box, api) => {
      box.classList.add('mid');
      box.append(h('h3', {}, 'Какой проект открыть?'),
        h('div', { class: 'hint' }, `В этом браузере есть проект «${P.name || 'Новый проект'}», а в аккаунте — «${latest.name}», изменён ${when(latest.updatedAt)}.`));
      api.buttons = [
        { label: 'Отмена', cancel: true, onClick: (a) => a.close('cancel') },
        { label: 'Сохранить этот в аккаунт', onClick: (a) => a.close('local') },
        { label: 'Открыть из аккаунта', primary: true, onClick: (a) => a.close('account') },
      ];
    });
  }

  /* ---------- запуск (ТЗ 11.4) ---------- */
  async function start() {
    try { const f = sessionStorage.getItem('planner.flash'); if (f) { sessionStorage.removeItem('planner.flash'); toast(f); } } catch {}
    handlePanelParam();
    if (!Session.token) return toGuest(false);
    ind('loading');
    let u;
    try { u = await Session.me(); }
    catch { ind('offline'); window.addEventListener('online', () => start(), { once: true }); return; }
    if (!u) return toGuest(false);
    Sync.user = u; renderAccount();
    Sync.mode = 'account';
    const id = lsGet(LS.id), dirty = lsGet(LS.dirty) === '1', rev = Number(lsGet(LS.rev)) || 0;
    try {
      if (id) {
        try {
          const r = await Session.api('GET', '/projects/' + id);
          Sync.id = id;
          if (dirty && r.rev > rev) { Sync.rev = rev; ind('conflict'); conflictDialog(r); }
          else if (dirty || Sync.edited) { Sync.rev = r.rev; lsSet(LS.rev, r.rev); Sync.lastKey = null; ind('saving'); push(); }
          else loadIntoEditor(r.data, r);
          return;
        } catch (e) { if (e.status !== 404) throw e; lsSet(LS.id, null); lsSet(LS.rev, null); }
      }
      const { projects } = await Session.api('GET', '/projects');
      const hasLocal = P.walls.length > 0;
      if (projects.length && !hasLocal) {
        const r = await Session.api('GET', '/projects/' + projects[0].id);
        loadIntoEditor(r.data, r);
      } else if (projects.length) {
        const c = await chooseDialog(projects[0]);
        if (c === 'account') { backupLocal(); const r = await Session.api('GET', '/projects/' + projects[0].id); loadIntoEditor(r.data, r); toast('Открыт проект из аккаунта. Прежний сохранён резервной копией в браузере'); }
        else if (c === 'local') { await bindNew(); if (Sync.id) toast('Проект сохранён в аккаунт'); }
        else { Sync.mode = 'detached'; ind('guest'); }
      } else {
        await bindNew();
      }
    } catch (e) {
      if (e.status === 401) return toGuest(true);
      ind('offline'); setTimeout(start, 15000);
    } finally { Sync.ready = true; }
  }

  function toGuest(expired) {
    Sync.mode = 'guest'; Sync.user = null; Sync.id = null; clearTimeout(Sync.timer);
    if (expired) { lsSet(LS.id, null); lsSet(LS.rev, null); lsSet(LS.dirty, null); }
    renderAccount(); ind('guest'); Sync.ready = true; maybeGuestHint();
  }

  /* ---------- аккаунт в шапке и меню (ТЗ 11.1) ---------- */
  function renderAccount() {
    const box = $('#acctBox'); if (!box) return;
    box.replaceChildren();
    const old = $('#acctMenu'); if (old) old.remove();
    if (MQ_PHONE.matches) return; // на телефоне — в основном меню
    if (!Sync.user) { box.append(h('a', { class: 'lbtn', href: '/login?next=/editor' }, 'Войти')); return; }
    const u = Sync.user;
    const btn = h('button', { type: 'button', class: 'ava', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Аккаунт: ' + (u.name || u.email) }, Session.initial(u.name || u.email));
    const menu = h('div', { id: 'acctMenu', class: 'dmenu', role: 'menu' }); menu.hidden = true;
    const it = (icon, label, fn, cls) => h('button', { type: 'button', class: 'mi' + (cls ? ' ' + cls : ''), role: 'menuitem', onclick: () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); fn(); } }, ic(icon), label);
    const lk = (icon, label, href) => h('a', { class: 'mi', role: 'menuitem', href }, ic(icon), label);
    const who = h('div', { class: 'who' }, h('b', {}, u.name || 'Без имени'), h('span', {}, u.email));
    menu.append(who, h('hr'), lk('home', 'На главную', '/'), it('key', 'Сменить пароль', changePassword));
    if (u.role === 'admin') menu.append(lk('settings', 'Админ‑панель', '/admin'));
    menu.append(h('hr'), it('logout', 'Выйти', logout, 'danger'));
    btn.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) menu.querySelector('.mi').focus(); };
    menu.addEventListener('keydown', (e) => {
      const its = [...menu.querySelectorAll('.mi')]; const i = its.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); menu.hidden = true; btn.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); (its[i + 1] || its[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (its[i - 1] || its[its.length - 1]).focus(); }
    });
    document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
    box.append(btn); $('header').append(menu);
  }
  MQ_PHONE.addEventListener('change', renderAccount);

  /* Пункты в основном меню редактора (вызывается из buildMenu) */
  window.accountMenuItems = function (menu) {
    const mi = (icon, label, fn, cls) => h('button', { type: 'button', class: 'mi' + (cls ? ' ' + cls : ''), role: 'menuitem', onclick: () => { menu.hidden = true; fn(); } }, ic(icon), label);
    const lk = (icon, label, href) => h('a', { class: 'mi', role: 'menuitem', href }, ic(icon), label);
    menu.append(lk('home', 'На главную', '/'));
    if (MQ_PHONE.matches) {
      if (Sync.user) {
        menu.append(h('div', { class: 'mh' }, Sync.user.email), mi('key', 'Сменить пароль', changePassword));
        if (Sync.user.role === 'admin') menu.append(lk('settings', 'Админ‑панель', '/admin'));
        menu.append(mi('logout', 'Выйти', logout, 'danger'));
      } else menu.append(lk('arrow-up', 'Войти или создать аккаунт', '/login?next=/editor'));
    }
    menu.append(h('hr'));
  };
  ICONS.home = '<path d="M3 11l9-7 9 7M5 10v10h14V10"/>';
  ICONS.key = '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>';
  ICONS.logout = '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>';
  ICONS.cloud = '<path d="M7 18a5 5 0 0 1-.6-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>';

  function changePassword() {
    dialog((box, api) => {
      box.append(h('h3', {}, 'Сменить пароль'));
      const cur = h('input', { type: 'password', autocomplete: 'current-password', style: 'width:100%' });
      const nx = h('input', { type: 'password', autocomplete: 'new-password', minlength: '8', maxlength: '128', style: 'width:100%' });
      box.append(h('label', { class: 'fld', style: 'margin:12px 0' }, h('span', {}, 'Текущий пароль'), cur), h('label', { class: 'fld', style: 'margin:12px 0' }, h('span', {}, 'Новый пароль'), nx, h('span', { class: 'desc' }, 'Не короче 8 символов. Остальные сеансы будут завершены.')));
      api.buttons = [{ label: 'Отмена', cancel: true, onClick: (a) => a.close(null) }, { label: 'Сменить пароль', primary: true, onClick: async (a) => {
        if (!cur.value) { a.err('Введите текущий пароль'); cur.focus(); return; }
        if (nx.value.length < 8) { a.err('Новый пароль — не короче 8 символов'); nx.focus(); return; }
        a.primaryBtn.disabled = true;
        try { await Session.api('POST', '/auth/password', { current: cur.value, next: nx.value }); a.close(true); toast('Пароль изменён'); }
        catch (e) { a.err(e.message); a.primaryBtn.disabled = false; }
      } }];
    });
  }

  /* ТЗ 7.4: выход. Ждём отправку изменений до 3 с, затем очищаем проект аккаунта из браузера. */
  async function logout() {
    if (Sync.mode === 'account' && lsGet(LS.dirty) === '1') {
      clearTimeout(Sync.timer); push();
      const t0 = Date.now();
      while (lsGet(LS.dirty) === '1' && Date.now() - t0 < 3000) await new Promise(r => setTimeout(r, 150));
      if (lsGet(LS.dirty) === '1' && !(await confirmDlg('Изменения не сохранены', 'Последние изменения не дошли до аккаунта. Всё равно выйти?'))) return;
    }
    Sync.mode = 'guest';
    await Session.logout();
    lsSet(LS.id, null); lsSet(LS.rev, null); lsSet(LS.dirty, null);
    P = normalizeProject(newProject()); D = derive(P); E.sel = null; E.mode = 'idle'; E.tool = 'select';
    hist = []; hi = -1; snapshot(); $('#projName').value = P.name;
    const res = $('#result'); if (res) { res.hidden = true; document.body.classList.remove('res'); }
    save(); updateTools(); updateModeUI(); fitRoom();
    toGuest(false); toast('Вы вышли из аккаунта');
  }
  /* Выход или вход в другой вкладке */
  window.addEventListener('planner:session', (e) => {
    const u = e.detail.user;
    if (!u && Sync.mode !== 'guest') toGuest(true);         // проект остаётся на экране, просто не синхронизируется
    else if (u && Sync.mode === 'guest') { Sync.ready = false; start(); }
  });

  /* ---------- подсказка гостю (ТЗ 11.5) ---------- */
  function hintDismissed() { const t = Number(lsGet(LS.hint)); return t && Date.now() - t < 14 * 864e5; }
  function maybeGuestHint() {
    const el = $('#guestHint');
    const want = Sync.ready && Sync.mode === 'guest' && P.closed && !hintDismissed() && !T3.active;
    if (!want) { if (el) el.remove(); return; }
    if (el) return;
    const n = h('div', { id: 'guestHint', role: 'note' }, h('span', {}, 'Проект хранится только в этом браузере.'), h('span', { class: 'sp' }),
      h('a', { class: 'lbtn primary', href: '/register?next=/editor' }, 'Создать аккаунт'),
      h('button', { type: 'button', class: 'x', 'aria-label': 'Скрыть подсказку', onclick: () => { lsSet(LS.hint, Date.now()); n.remove(); } }, ic('close')));
    $('main').append(n);
  }
  window.onResultShown = function (wrap) {
    if (Sync.mode !== 'guest') return;
    wrap.append(h('div', { class: 'card res-save' }, h('div', {}, h('h4', { style: 'margin:0 0 4px' }, 'Сохраните бриф в аккаунте'), h('div', { class: 'hint', style: 'margin:0' }, 'Сейчас проект и бриф хранятся только в этом браузере.')),
      h('a', { class: 'lbtn primary', href: '/register?next=/editor', style: 'height:36px;padding:0 16px;font-size:14px' }, 'Создать аккаунт')));
  };
  window.photoNote = function () { return Sync.mode === 'account' ? h('div', { class: 'photo-note' }, ic('info'), 'Фото пока сохраняются только на этом устройстве') : null; };

  /* ---------- ?panel=catalog (ТЗ 11.6) ---------- */
  function handlePanelParam() {
    const q = new URLSearchParams(location.search);
    if (q.get('panel') !== 'catalog') return;
    q.delete('panel'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
    if (!P.closed) { toast('Сначала замкните контур комнаты — каталог откроется в режиме «Мебель»'); return; }
    if (P.mode !== 'furniture') setMode('furniture'); else buildCatalog();
    if (MQ_PHONE.matches) setCatalogOpen(true);
  }

  /* ---------- уход со страницы ---------- */
  window.addEventListener('beforeunload', (e) => {
    if (Sync.mode !== 'account' || lsGet(LS.dirty) !== '1' || !Sync.id) return;
    const body = JSON.stringify({ name: P.name, data: payload(), rev: Sync.rev });
    if (body.length <= 64 * 1024 && Session.token) {
      try { fetch('/api/projects/' + Sync.id, { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + Session.token }, body }); } catch {}
    }
    e.preventDefault(); e.returnValue = '';
  });

  document.title = (P.name || 'Новый проект') + ' — furnitech';
  start();
})();
