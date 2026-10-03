'use strict';
/* furnitech · редактор · account.js
   Редактор в аккаунте (ТЗ этапа 1, разделы 7 и 11; ТЗ этапа 2, разделы 7.4 и 8.4). Подключается последним
   и пользуется глобальными объявлениями остальных файлов: P, D, derive, save, render, dialog, confirmDlg, h, ic, toast…
   Редактор открыт только вошедшему пользователю: проект создаётся и хранится в аккаунте.
   Гостя на вход отправляет встроенный скрипт в editor.html (ещё до загрузки редактора) и start() здесь.
   Режимы:
     boot    — запуск: сессия ещё проверяется;
     account — локальная копия + синхронизация с /api/projects (PUT с проверкой версии);
     locked  — сессия закончилась во время работы: только просмотр и приглашение войти;
     view    — поддержка смотрит чужой проект (/editor?view=<id>): только чтение, ничего не сохраняется.
   Адрес: /editor?project=<id> — открыть проект аккаунта; параметр всегда соответствует открытому проекту. */
(function () {
  const LS = { id: 'roomEditor.projectId', rev: 'roomEditor.projectRev', dirty: 'roomEditor.dirty', owner: 'roomEditor.projectUser', backup: 'roomEditor.project.backup' };
  const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
  const VIEW_ID = (() => { const v = new URLSearchParams(location.search).get('view'); return v && ID_RE.test(v) ? v : null; })();
  if (VIEW_ID) READONLY = true; // сразу, до любых таймеров сохранения: свой локальный проект администратора не трогаем
  const SKIP = ['viewport', 'panelCollapsed']; // вид плана не синхронизируем — иначе прокрутка плодит версии
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, String(v)); } catch {} };
  const hhmm = (d) => new Date(d || Date.now()).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  const when = (iso) => { const d = new Date(iso); const today = new Date().toDateString() === d.toDateString(); return today ? 'сегодня в ' + hhmm(d) : d.toLocaleString('ru', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }); };

  const Sync = { mode: 'boot', user: null, id: null, rev: 0, lastKey: null, inflight: false, again: false, timer: null, retryStep: 0, state: 'idle', edited: false, ready: false, mail: false, warned: false, stale: false, checking: false };
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
.res-save{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.photo-note{font-size:13px;color:var(--muted-foreground);margin:6px 0 10px;display:flex;gap:6px;align-items:center}
#roBanner{position:absolute;left:12px;right:12px;top:calc(var(--gap) + var(--safe-top));margin:0 auto;width:fit-content;max-width:calc(100% - 24px);z-index:7;display:flex;align-items:center;gap:10px;padding:8px 14px;font-size:13px;line-height:18px;
  background:var(--warning-soft);color:var(--warning);border:1px solid color-mix(in srgb,var(--warning) 30%,transparent);border-radius:var(--radius-lg);box-shadow:var(--shadow-md)}
#roBanner b{font-weight:600;overflow-wrap:anywhere}
#roBanner .ic{flex:none;width:16px;height:16px}
#roBanner span{min-width:0}
@media (max-width:640px){#roBanner{flex-wrap:wrap;justify-content:center;text-align:center;right:64px}}
#roBanner a{color:inherit;font-weight:500;text-underline-offset:3px;white-space:nowrap}
body.ro #btnFinish,body.ro #btnLock,body.ro #catalog,body.ro #dockCat,body.ro #tools [data-tool]:not([data-tool=select]),body.ro [data-view=undo],body.ro [data-view=redo]{display:none!important}
body.ro #props input,body.ro #props select,body.ro #props textarea,body.ro #props button:not(.back),body.ro #widget button.iconbtn,body.ro #matPanel{pointer-events:none;opacity:.6}
`));

  /* ---------- индикатор сохранения (ТЗ 11.2) ---------- */
  function ind(state, extra) {
    Sync.state = state;
    const el = document.getElementById('saveInd'); if (!el) return;
    el.classList.toggle('warn', state === 'offline' || state === 'conflict');
    const t = {
      local: 'В браузере ' + hhmm(),
      locked: 'Нужен вход',
      saving: 'Сохранение…',
      saved: null,
      offline: 'Нет связи — сохранено в браузере',
      conflict: 'Есть изменения с другого устройства',
      loading: 'Загрузка…',
      view: 'Только просмотр',
      error: extra || 'Не сохраняется',
    }[state];
    if (state === 'saved') { el.replaceChildren(ic('cloud-check'), 'Сохранено ' + hhmm()); el.title = 'Сохранено в аккаунте'; return; }
    el.textContent = t; el.title = state === 'local' ? 'Записано в этом браузере, в аккаунт ещё не отправлено' : state === 'view' ? 'Изменения не сохраняются' : state === 'locked' ? 'Сессия истекла — войдите, чтобы продолжить' : '';
  }
  ICONS['cloud-check'] = '<path d="M7 18a5 5 0 0 1-.6-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/><path d="M9.5 13l2 2 3.5-4"/>';

  /* ---------- что отправляем на сервер ---------- */
  function payload() { const o = {}; for (const k in P) if (!SKIP.includes(k)) o[k] = P[k]; return o; }
  const key = () => JSON.stringify(payload());

  /* Хук основного скрипта: вызывается после каждого локального сохранения */
  window.afterLocalSave = function (ok) {
    document.title = (P.name || 'Новый проект') + ' — furnitech';
    if (Sync.mode === 'view' || Sync.stale) return;
    if (Sync.mode !== 'account') {
      if (lsGet(LS.id)) lsSet(LS.dirty, '1'); // сессия ещё не проверена или нет связи: правки дойдут до аккаунта позже
      ind(ok ? 'local' : 'error'); return;
    }
    const k = key();
    if (k === Sync.lastKey) return; // изменился только вид плана
    if (Sync.ready) Sync.edited = true;
    lsSet(LS.dirty, '1');
    if (Sync.state !== 'offline' && Sync.state !== 'conflict') ind('saving');
    schedule(1500);
  };

  function schedule(ms) { clearTimeout(Sync.timer); Sync.timer = setTimeout(push, ms); }

  /* ---------- одна локальная копия на браузер ----------
     В localStorage лежит один проект. Если в другой вкладке открыли другой проект (или этот удалили в «Моих проектах»),
     привязка в localStorage перестаёт совпадать с проектом этой вкладки. Писать туда отсюда больше нельзя —
     иначе данные одного проекта попадут в другой. */
  const own = () => !Sync.id || lsGet(LS.id) === Sync.id;
  window.beforeLocalSave = function () {
    if (Sync.mode !== 'account' || own()) return true;
    lostLocal(); return false;
  };
  window.addEventListener('storage', (e) => { if (e.key === LS.id && Sync.mode === 'account' && Sync.id && e.newValue !== Sync.id) lostLocal(); });
  /* Последняя отправка из памяти вкладки — без записи в localStorage */
  async function lastPush() {
    const k = key();
    if (k === Sync.lastKey) return true;
    const put = (rev) => Session.api('PUT', '/projects/' + Sync.id, { name: P.name, data: JSON.parse(k), rev });
    try {
      let r;
      try { r = await put(Sync.rev); }
      catch (e) {
        /* версия ушла вперёд: другая вкладка перед переключением отправила ту же локальную копию.
           В памяти этой вкладки состояние не старее, поэтому отправляем его поверх. */
        if (!(e.status === 409 && e.details && Number.isInteger(e.details.rev))) throw e;
        r = await put(e.details.rev);
      }
      Sync.rev = r.rev; Sync.lastKey = k; return true;
    } catch { return false; }
  }
  async function lostLocal() {
    if (Sync.stale || Sync.checking || Sync.mode !== 'account' || !Sync.id) return;
    if (!lsGet(LS.id)) {
      /* привязку убрали: проект удалили в «Моих проектах» (тогда сервер ответит 404) либо вышли из аккаунта в другой вкладке */
      if (!Session.token) return;
      Sync.checking = true;
      try { await Session.api('GET', '/projects/' + Sync.id); if (!lsGet(LS.id)) { lsSet(LS.id, Sync.id); lsSet(LS.rev, Sync.rev); lsSet(LS.owner, Sync.user ? Sync.user.id : null); } }
      catch (e) { if (e.status === 404) await gone().catch(() => ind('offline')); }
      Sync.checking = false; return;
    }
    Sync.stale = true; clearTimeout(Sync.timer);
    const id = Sync.id, name = P.name || 'Новый проект';
    let saved = await lastPush();
    READONLY = true; readOnlyUi();
    for (;;) {
      const c = await dialog((box, api) => {
        box.classList.add('mid');
        box.append(h('h3', {}, 'В другой вкладке открыт другой проект'),
          h('div', { class: 'hint' }, `Редактор держит в браузере один проект. Чтобы проекты не перемешались, «${name}» в этой вкладке теперь только для просмотра.`),
          h('div', { class: 'hint' }, saved ? 'Все изменения сохранены в аккаунте.' : 'Последние изменения не удалось сохранить в аккаунт. Проверьте интернет и повторите.'));
        api.buttons = saved
          ? [{ label: 'К моим проектам', cancel: true, onClick: (a) => a.close('projects') }, { label: `Открыть «${name}» здесь`, primary: true, onClick: (a) => a.close('open') }]
          : [{ label: 'Закрыть без сохранения', cancel: true, onClick: (a) => a.close('projects') }, { label: 'Повторить сохранение', primary: true, onClick: (a) => a.close('retry') }];
      });
      if (c === 'retry') { saved = await lastPush(); continue; }
      if (c === 'projects') location.href = '/projects';
      else if (c === 'open') location.href = '/editor?project=' + encodeURIComponent(id);
      return;
    }
  }

  /* ---------- отправка (ТЗ 11.3) ---------- */
  const BACKOFF = [2, 5, 15, 30];
  async function push() {
    if (Sync.mode !== 'account' || !Sync.id || Sync.stale) return;
    if (!own()) { lostLocal(); return; }
    if (Sync.state === 'conflict') return;
    if (Sync.inflight) { Sync.again = true; return; }
    const k = key();
    if (k === Sync.lastKey) { lsSet(LS.dirty, null); ind('saved'); return; }
    Sync.inflight = true; Sync.again = false;
    try {
      const r = await Session.api('PUT', '/projects/' + Sync.id, { name: P.name, data: JSON.parse(k), rev: Sync.rev });
      Sync.rev = r.rev; Sync.lastKey = k; Sync.retryStep = 0;
      if (!own()) { Sync.inflight = false; lostLocal(); return; }
      lsSet(LS.rev, r.rev);
      if (key() === k) { lsSet(LS.dirty, null); ind('saved'); } else Sync.again = true;
    } catch (e) {
      if (e.status === 409 && e.code === 'conflict') { ind('conflict'); Sync.inflight = false; conflictDialog(e.details); return; }
      if (e.status === 401) { Sync.inflight = false; sessionLost(); return; }
      if (e.status === 404) { Sync.inflight = false; gone().catch(() => ind('offline')); return; }
      if (unverified(e)) { Sync.inflight = false; return; }
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
    Sync.id = meta.id; Sync.rev = meta.rev; bind(meta.id, meta.rev);
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

  /* Привязка локальной копии к проекту аккаунта и её владельцу; адрес страницы следует за проектом */
  function bind(id, rev) {
    lsSet(LS.id, id); lsSet(LS.rev, rev); lsSet(LS.dirty, null); lsSet(LS.owner, Sync.user ? Sync.user.id : null);
    setProjectParam(id);
  }
  function unbind() { Sync.id = null; Sync.lastKey = null; lsSet(LS.id, null); lsSet(LS.rev, null); lsSet(LS.dirty, null); lsSet(LS.owner, null); setProjectParam(null); }
  function setProjectParam(id) {
    const q = new URLSearchParams(location.search);
    if (id) q.set('project', id); else q.delete('project');
    const qs = q.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }
  /* Пустой редактор: локальная копия заменяется новым проектом */
  function blankEditor() {
    P = normalizeProject(newProject()); D = derive(P); E.sel = null; E.mode = 'idle'; E.tool = 'select'; E.propsOpen = false;
    hist = []; hi = -1; snapshot(); $('#projName').value = P.name; $('#unitSel').value = P.unit;
    const res = $('#result'); if (res) { res.hidden = true; document.body.classList.remove('res'); }
    save(); updateTools(); updateModeUI(); fitRoom();
  }
  /* Строгий режим подтверждения почты: сервер не принимает запись, пока почта не подтверждена */
  function unverified(e) {
    if (!(e.status === 403 && e.code === 'email_unverified')) return false;
    ind('error', 'Почта не подтверждена');
    if (!Sync.warned) { Sync.warned = true; toast('Подтвердите почту, чтобы сохранять проекты в аккаунт. Пока проект хранится в этом браузере', true); }
    return true;
  }

  /* Создать в аккаунте проект из текущего локального */
  async function bindNew() {
    try {
      const k = key();
      const r = await Session.api('POST', '/projects', { name: P.name, data: JSON.parse(k) });
      Sync.id = r.id; Sync.rev = r.rev; bind(r.id, r.rev);
      Sync.lastKey = k; ind('saved');
      if (key() !== k) { lsSet(LS.dirty, '1'); schedule(300); }
    } catch (e) {
      if (e.status === 401) throw e;
      if (unverified(e)) return;
      if (e.status === 0 || e.status >= 500 || e.status === 429) { ind('offline'); setTimeout(() => { if (!Sync.id && Sync.mode === 'account') bindNew().catch(() => {}); }, (e.retryAfter || 15) * 1000); }
      else { ind('error', e.code === 'limit' ? 'В аккаунте нет места' : e.message); if (e.code === 'limit') toast(e.message, true); }
    }
  }

  /* Проект удалён из аккаунта (на другом устройстве или в «Моих проектах»). Сам он обратно не создаётся:
     несохранённую работу предлагаем сохранить новым проектом, иначе открываем другой проект. */
  async function gone() {
    const name = P.name || 'Новый проект';
    const work = P.walls.length > 0 && (lsGet(LS.dirty) === '1' || Sync.edited);
    clearTimeout(Sync.timer); unbind();
    if (work) {
      const c = await dialog((box, api) => {
        box.classList.add('mid');
        box.append(h('h3', {}, 'Проект удалён из аккаунта'),
          h('div', { class: 'hint' }, `Проект «${name}» удалили на другом устройстве, а в этом браузере остались изменения, которых нет в аккаунте.`));
        api.buttons = [
          { label: 'Не сохранять', cancel: true, onClick: (a) => a.close('drop') },
          { label: 'Сохранить как новый проект', primary: true, onClick: (a) => a.close('keep') },
        ];
      });
      if (c === 'keep') { await bindNew(); if (Sync.id) toast('Проект сохранён в аккаунт как новый'); return; }
    } else toast(`Проект «${name}» удалён из аккаунта`);
    blankEditor();
    await openDefault();
  }

  /* Отправить изменения прежнего проекта перед переключением; ждём не дольше ms */
  async function flush(id, ms) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try { await Session.api('PUT', '/projects/' + id, { name: P.name, data: payload(), rev: Number(lsGet(LS.rev)) || 0 }, { signal: ctl.signal }); lsSet(LS.dirty, null); return true; }
    catch (e) { if (e.status === 401) throw e; return e.status === 404; } // 404: проект уже удалён — сохранять нечего
    finally { clearTimeout(t); }
  }
  function leaveDialog(title, text, stay, go) {
    return dialog((box, api) => {
      box.classList.add('mid');
      box.append(h('h3', {}, title), h('div', { class: 'hint' }, text), h('div', { class: 'hint' }, 'Если продолжить, текущий проект останется только резервной копией в этом браузере.'));
      api.buttons = [{ label: stay, cancel: true, onClick: (a) => a.close('stay') }, { label: go, primary: true, onClick: (a) => a.close('go') }];
    });
  }
  /* Открыть другой проект аккаунта (/editor?project=<id>). false — остаёмся в прежнем проекте. */
  async function switchTo(want) {
    let target;
    try { target = await Session.api('GET', '/projects/' + want); }
    catch (e) {
      if (e.status !== 404) throw e;
      try { sessionStorage.setItem('planner.flash', 'Проект не найден или удалён'); } catch {}
      location.replace('/projects'); return null; // null — запуск редактора прекращается
    }
    const id = lsGet(LS.id), name = P.name || 'Новый проект';
    if (id && lsGet(LS.dirty) === '1') {
      if (!(await flush(id, 5000))) {
        const c = await leaveDialog('Изменения не сохранены', `Последние изменения проекта «${name}» не удалось отправить в аккаунт.`, `Остаться в «${name}»`, `Открыть «${target.name}»`);
        if (c !== 'go') { setProjectParam(id); return false; }
        backupLocal();
      }
    } else if (!id && P.walls.length > 0) {
      /* проект, начатый без аккаунта: сохраняем его в аккаунт, чтобы он не пропал */
      try { await Session.api('POST', '/projects', { name: P.name, data: payload() }); toast(`Проект «${name}» из этого браузера сохранён в аккаунт`); }
      catch (e) {
        if (e.status === 401 || e.status === 0 || e.status >= 500) throw e;
        const c = await leaveDialog('Проект из браузера не сохранён', `Проект «${name}» есть только в этом браузере, и сохранить его в аккаунт не удалось: ${e.message}.`, 'Остаться', `Открыть «${target.name}»`);
        if (c !== 'go') { setProjectParam(null); ind('error', 'Не сохранён в аккаунт'); return null; }
        backupLocal();
      }
    }
    Sync.id = null; // вид плана берём из открываемого проекта
    loadIntoEditor(target.data, target);
    return true;
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
  /* Привязанного проекта нет. Если в браузере остался проект без привязки (начат до обязательной регистрации
     или не сохранился из‑за лимита либо неподтверждённой почты) — он сохраняется в аккаунт новым проектом.
     Иначе открывается последний проект аккаунта, а если проектов нет — создаётся первый. */
  async function openDefault() {
    if (P.walls.length > 0) { await bindNew(); if (Sync.id) toast('Проект из этого браузера сохранён в аккаунт'); return; }
    const { projects } = await Session.api('GET', '/projects');
    if (projects.length) { const r = await Session.api('GET', '/projects/' + projects[0].id); loadIntoEditor(r.data, r); }
    else await bindNew();
  }
  const wanted = () => { const v = new URLSearchParams(location.search).get('project'); return v && ID_RE.test(v) ? v : null; };
  const toLogin = () => location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search));

  /* ---------- запуск (ТЗ этапа 1, 11.4; ТЗ этапа 2, 7.4) ---------- */
  async function start() {
    try { const f = sessionStorage.getItem('planner.flash'); if (f) { sessionStorage.removeItem('planner.flash'); toast(f); } } catch {}
    if (VIEW_ID) return startView();
    const want = wanted();
    if (!Session.token) return toLogin(); // проект создаётся только в аккаунте
    ind('loading');
    let u;
    try { u = await Session.me(); }
    catch { ind('offline'); window.addEventListener('online', () => start(), { once: true }); return; }
    if (!u) return toLogin();
    handlePanelParam();
    Sync.user = u; Sync.mode = 'account'; renderAccount();
    fetch('/api/config', { headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : {})).then((c) => { Sync.mail = c.mail === true; renderAccount(); }).catch(() => {});
    /* локальная копия привязана к проекту другого аккаунта — не показываем и не предлагаем её */
    const owner = lsGet(LS.owner);
    if (owner && owner !== u.id) { unbind(); blankEditor(); }
    try {
      if (want && want !== lsGet(LS.id)) { const sw = await switchTo(want); if (sw !== false) return; }
      const id = lsGet(LS.id), dirty = lsGet(LS.dirty) === '1', rev = Number(lsGet(LS.rev)) || 0;
      if (id) {
        let r;
        try { r = await Session.api('GET', '/projects/' + id); }
        catch (e) { if (e.status !== 404) throw e; await gone(); return; }
        Sync.id = id; lsSet(LS.owner, u.id); setProjectParam(id);
        if (dirty && r.rev > rev) { Sync.rev = rev; ind('conflict'); conflictDialog(r); }
        else if (dirty || Sync.edited) { Sync.rev = r.rev; lsSet(LS.rev, r.rev); Sync.lastKey = null; ind('saving'); push(); }
        else loadIntoEditor(r.data, r);
        return;
      }
      await openDefault();
    } catch (e) {
      if (e.status === 401) return sessionLost();
      ind('offline'); setTimeout(start, 15000);
    } finally { Sync.ready = true; }
  }

  /* Сессия закончилась во время работы (истекла, завершена с другого устройства, аккаунт заблокирован).
     Проект остаётся на экране только для просмотра; последние правки записаны в локальную копию
     и уйдут в аккаунт после входа тем же пользователем (привязка к проекту и владельцу сохраняется). */
  let lost = false;
  function sessionLost() {
    if (lost || Sync.mode === 'view') return;
    lost = true; clearTimeout(Sync.timer);
    if (Sync.mode === 'account' && Sync.id && own() && !READONLY) {
      try { localStorage.setItem('roomEditor.project', JSON.stringify(P)); if (key() !== Sync.lastKey) lsSet(LS.dirty, '1'); } catch {}
    }
    Sync.mode = 'locked'; Sync.user = null; Sync.ready = true;
    READONLY = true; readOnlyUi(); ind('locked'); renderAccount();
    dialog((box, api) => {
      box.append(h('h3', {}, 'Сессия истекла'), h('div', { class: 'hint' }, 'Войдите снова, чтобы продолжить. Последние изменения сохранены в этом браузере и попадут в аккаунт после входа.'));
      api.buttons = [{ label: 'Войти', primary: true, onClick: (a) => a.close(true) }];
    }).then(toLogin);
  }

  /* В режиме просмотра поля панели свойств и панели материалов недоступны и с клавиатуры */
  function lockPanels() {
    document.querySelectorAll('#props input, #props select, #props textarea, #props button:not(.back), #widget button.iconbtn, #matPanel input, #matPanel select, #matPanel button').forEach((el) => { el.disabled = true; });
  }
  let panelsWatched = false;
  function readOnlyUi() {
    document.body.classList.add('ro'); ind('view');
    if (!panelsWatched) { panelsWatched = true; new MutationObserver(lockPanels).observe(document.body, { childList: true, subtree: true }); }
    lockPanels();
  }

  /* ---------- просмотр чужого проекта поддержкой (ТЗ этапа 2, 8.4) ---------- */
  async function startView() {
    Sync.mode = 'view'; Sync.ready = true; readOnlyUi();
    $('#projName').readOnly = true;
    P = normalizeProject(newProject()); D = derive(P); hist = []; hi = -1; snapshot(); $('#projName').value = ''; render();
    const box = $('#acctBox'); if (box) box.replaceChildren(h('a', { class: 'lbtn', href: '/admin#/users' }, 'В админ‑панель'));
    const fail = (title, text) => dialog((b, api) => {
      b.append(h('h3', {}, title), h('div', { class: 'hint' }, text));
      api.buttons = [{ label: 'В админ‑панель', primary: true, onClick: (a) => a.close(true) }];
    }).then(() => { location.href = '/admin#/users'; });
    let tok = null; try { tok = localStorage.getItem('admin.token'); } catch {}
    if (!tok) return fail('Нужен вход администратора', 'Проекты пользователей открываются для просмотра только из админ‑панели.');
    let r;
    try {
      const res = await fetch('/api/admin/projects/' + encodeURIComponent(VIEW_ID), { headers: { Accept: 'application/json', Authorization: 'Bearer ' + tok } });
      let j = null; try { j = await res.json(); } catch {}
      if (res.status === 401 || res.status === 403) return fail('Нужен вход администратора', 'Войдите в админ‑панель и откройте проект из карточки пользователя.');
      if (res.status === 404) return fail('Проект не найден', 'Возможно, пользователь его удалил.');
      if (!res.ok || !j) return fail('Не удалось открыть проект', (j && j.error && j.error.message) || 'Ошибка сервера (' + res.status + ')');
      r = j;
    } catch { return fail('Нет связи', 'Не удалось связаться с сервером. Проверьте интернет и обновите страницу.'); }
    if (!r.data || !Array.isArray(r.data.walls) || !Array.isArray(r.data.vertices)) return fail('Проект повреждён', 'Данные проекта не читаются.');
    const p = normalizeProject(Object.assign({}, r.data)); p.name = r.name;
    if (p.mode === 'furniture' && !p.closed) p.mode = 'walls';
    P = p; D = derive(P); E.sel = null; E.mode = 'idle'; E.tool = 'select'; E.propsOpen = false;
    hist = []; hi = -1; snapshot(); $('#projName').value = P.name; $('#unitSel').value = P.unit;
    updateTools(); updateModeUI(); if (P.mode === 'furniture') buildCatalog(); fitRoom();
    document.title = 'Просмотр: ' + (P.name || 'проект') + ' — furnitech';
    $('main').append(h('div', { id: 'roBanner', role: 'status' }, ic('eye'),
      h('span', {}, 'Просмотр проекта пользователя ', h('b', {}, r.owner.email), ' · только чтение · версия ' + r.rev + ' от ' + new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(r.updatedAt))),
      h('a', { href: '/admin#/users/' + encodeURIComponent(r.owner.id) }, 'К пользователю')));
  }

  /* ---------- аккаунт в шапке и меню (ТЗ 11.1) ---------- */
  function renderAccount() {
    const box = $('#acctBox'); if (!box) return;
    box.replaceChildren();
    const old = $('#acctMenu'); if (old) old.remove();
    if (MQ_PHONE.matches) return; // на телефоне — в основном меню
    if (Sync.mode === 'view') return;
    if (!Sync.user) { if (Sync.mode === 'locked') box.append(h('a', { class: 'lbtn primary', href: '/login?next=' + encodeURIComponent(location.pathname + location.search) }, 'Войти')); return; }
    const u = Sync.user;
    const btn = h('button', { type: 'button', class: 'ava', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Аккаунт: ' + (u.name || u.email) }, Session.initial(u.name || u.email));
    const menu = h('div', { id: 'acctMenu', class: 'dmenu', role: 'menu' }); menu.hidden = true;
    const it = (icon, label, fn, cls) => h('button', { type: 'button', class: 'mi' + (cls ? ' ' + cls : ''), role: 'menuitem', onclick: () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); fn(); } }, ic(icon), label);
    const lk = (icon, label, href) => h('a', { class: 'mi', role: 'menuitem', href }, ic(icon), label);
    const who = h('div', { class: 'who' }, h('b', {}, u.name || 'Без имени'), h('span', {}, u.email));
    menu.append(who, h('hr'), lk('folder', 'Мои проекты', '/projects'), lk('user', 'Аккаунт', '/account'));
    if (needsVerify()) menu.append(lk('mail', 'Подтвердить почту', '/account'));
    menu.append(lk('home', 'На главную', '/'));
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
  const needsVerify = () => !!Sync.user && Sync.user.emailVerified === false && Sync.user.role !== 'admin' && Sync.mail;

  /* Пункты в основном меню редактора (вызывается из buildMenu) */
  window.accountMenuItems = function (menu) {
    const mi = (icon, label, fn, cls) => h('button', { type: 'button', class: 'mi' + (cls ? ' ' + cls : ''), role: 'menuitem', onclick: () => { menu.hidden = true; fn(); } }, ic(icon), label);
    const lk = (icon, label, href) => h('a', { class: 'mi', role: 'menuitem', href }, ic(icon), label);
    if (Sync.mode === 'view') { menu.append(lk('settings', 'В админ‑панель', '/admin#/users'), h('hr')); return; }
    if (Sync.user) menu.append(lk('folder', 'Мои проекты', '/projects'));
    menu.append(lk('home', 'На главную', '/'));
    if (MQ_PHONE.matches) {
      if (Sync.user) {
        menu.append(h('div', { class: 'mh' }, Sync.user.email), lk('user', 'Аккаунт', '/account'));
        if (needsVerify()) menu.append(lk('mail', 'Подтвердить почту', '/account'));
        if (Sync.user.role === 'admin') menu.append(lk('settings', 'Админ‑панель', '/admin'));
        menu.append(mi('logout', 'Выйти', logout, 'danger'));
      } else if (Sync.mode === 'locked') menu.append(lk('arrow-up', 'Войти', '/login?next=' + encodeURIComponent(location.pathname + location.search)));
    }
    menu.append(h('hr'));
  };
  ICONS.home = '<path d="M3 11l9-7 9 7M5 10v10h14V10"/>';
  ICONS.key = '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>';
  ICONS.logout = '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>';
  ICONS.cloud = '<path d="M7 18a5 5 0 0 1-.6-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>';
  ICONS.folder = '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>';
  ICONS.user = '<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/>';
  ICONS.mail = '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>';

  /* ТЗ 7.4: выход. Ждём отправку изменений до 3 с, затем очищаем проект аккаунта из браузера. */
  async function logout() {
    if (Sync.mode === 'account' && lsGet(LS.dirty) === '1') {
      clearTimeout(Sync.timer); push();
      const t0 = Date.now();
      while (lsGet(LS.dirty) === '1' && Date.now() - t0 < 3000) await new Promise(r => setTimeout(r, 150));
      if (lsGet(LS.dirty) === '1' && !(await confirmDlg('Изменения не сохранены', 'Последние изменения не дошли до аккаунта. Всё равно выйти?'))) return;
    }
    Sync.mode = 'locked'; clearTimeout(Sync.timer);
    await Session.logout();
    unbind();
    try { sessionStorage.setItem('planner.flash', 'Вы вышли из аккаунта'); } catch {}
    location.replace('/'); // без входа редактор не работает
  }
  /* Выход или вход в другой вкладке */
  window.addEventListener('planner:session', (e) => {
    const u = e.detail.user;
    if (Sync.mode === 'view' || lost || Sync.mode === 'boot') return; // при запуске сессию проверяет start()
    if (!u && Sync.mode === 'account') {
      /* явный выход в другой вкладке убрал привязку и локальную копию — уходим на вход;
         истёкшая сессия привязку не трогает: проект остаётся на экране до входа */
      if (!lsGet(LS.id) && Sync.id) { Sync.mode = 'locked'; clearTimeout(Sync.timer); Sync.id = null; toLogin(); }
      else sessionLost();
    } else if (u && Sync.mode === 'locked') location.reload(); // вошли в другой вкладке
  });

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
    if (Sync.mode !== 'account' || Sync.stale || !own() || lsGet(LS.dirty) !== '1' || !Sync.id) return;
    const body = JSON.stringify({ name: P.name, data: payload(), rev: Sync.rev });
    if (body.length <= 64 * 1024 && Session.token) {
      try { fetch('/api/projects/' + Sync.id, { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + Session.token }, body }); } catch {}
    }
    e.preventDefault(); e.returnValue = '';
  });

  document.title = (P.name || 'Новый проект') + ' — furnitech';
  start();
})();
