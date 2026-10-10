'use strict';
/* Сквозная проверка визуализации комнаты в браузере на заглушке модели (RENDER_MOCK=1: «картинкой» становится сам кадр):
   комната с мебелью → 3D → «Визуализация» → ракурсы → первая картинка → ещё ракурс в том же стиле → удаление →
   смета → просмотр по ссылке владельца.
   Запуск из корня проекта:  node tools/render-check/e2e.cjs
   Нужен пакет playwright и Chromium (как для tools/ai-eval/e2e.cjs). Переменные:
     PLAYWRIGHT_PATH  путь к уже установленному пакету playwright
     E2E_SHOTS        куда складывать снимки экрана (по умолчанию tools/render-check/shots)
     E2E_HEADED=1     показать окно браузера */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const ROOT = path.join(__dirname, '..', '..');
const PORT = 8900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'shots');
const log = (...a) => console.log('·', ...a);

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-render-e2e-'));
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, RENDER_MOCK: '1', RENDER_DAILY: '4', MAIL_MODE: 'off', AUTH_PAD_MS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let srvLog = ''; srv.stdout.on('data', (d) => { srvLog += d; }); srv.stderr.on('data', (d) => { srvLog += d; });
  let browser;
  try {
    for (let i = 0; ; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.ok) break; } catch {} if (i > 150) throw new Error('сервер не поднялся:\n' + srvLog); await new Promise((r) => setTimeout(r, 200)); }
    const reg = await (await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Проверка', email: 'render@example.test', password: 'correct horse battery 42', acceptTerms: true }) })).json();
    assert.ok(reg.token, 'регистрация: ' + JSON.stringify(reg));
    const auth = { authorization: 'Bearer ' + reg.token };
    assert.deepEqual((await (await fetch(BASE + '/api/config')).json()).render, { enabled: true, mock: true, daily: 4 });

    browser = await chromium.launch({ headless: !process.env.E2E_HEADED, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript((t) => { try { if (!/[?&]share=/.test(location.search)) localStorage.setItem('planner.token', t); } catch {} }, reg.token);
    const page = await ctx.newPage();
    const errors = []; const watch = (p) => { p.on('pageerror', (e) => errors.push(String((e && e.stack) || e))); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); }); };
    watch(page);
    /* окно появляется плавно, а в браузере без экрана кадры рисуются редко: ждём, пока оно проявится целиком */
    const shot = async (name, p = page) => { await p.waitForFunction(() => { const o = document.querySelector('#overlay'); return o.hidden || getComputedStyle(o).opacity === '1'; }, null, { timeout: 15000 }).catch(() => {}); return p.screenshot({ path: path.join(SHOTS, name + '.png') }); };
    await page.goto(BASE + '/editor');
    await page.waitForFunction(() => window.EditorSync && EditorSync.mode === 'account' && EditorSync.id && typeof CATALOG_SOURCE !== 'undefined' && CATALOG_SOURCE === 'server', null, { timeout: 30000 });

    /* комната 5×4 м с окном и дверью; мебель — товары каталога и одна пустышка */
    const built = await page.evaluate(() => {
      const err = apply((Q) => {
        Q.vertices = [{ id: 'v1', x: 0, y: 0 }, { id: 'v2', x: 5000, y: 0 }, { id: 'v3', x: 5000, y: 4000 }, { id: 'v4', x: 0, y: 4000 }];
        Q.walls = [{ id: 'w1', a: 'v1', b: 'v2' }, { id: 'w2', a: 'v2', b: 'v3' }, { id: 'w3', a: 'v3', b: 'v4' }, { id: 'w4', a: 'v4', b: 'v1', material: { type: 'texture', textureId: 'brick', scale: 100, rotation: 0, offset: [0, 0] } }];
        Q.openings = [{ id: 'o1', kind: 'window', name: 'Окно 1', wallId: 'w1', offset: 1700, width: 1500, height: 1400, sill: 900 }, { id: 'o2', kind: 'door', name: 'Дверь 1', wallId: 'w3', offset: 400, width: 900, height: 2000, hinge: 'left', swing: 'in' }];
        Q.wallParamsSet = true; Q.seq = { door: 1, window: 1, arch: 0 };
      });
      if (err) return { err };
      setMode('furniture');
      const pick = (typeId) => PRODUCTS.find((p) => p.typeId === typeId && p.model && p.images && p.images.length);
      const put = (typeId, x, y, rot, product) => { const t = TYPE.get(typeId); const f = Object.assign(makeFurniture(t, (product ? product.formId : t.forms[0].id), {}, product || null, false), { x, y, rot }); const e = apply((Q) => { Q.furniture.push(f); if (!f.productId) Q.fseq[t.id] = (Q.fseq[t.id] || 0) + 1; refreshWarnings(Q); Q._strict = [f.id]; }); return e ? { err: typeId + ': ' + e } : f.id; };
      const ids = [put('sofa', 2500, 3300, 180, pick('sofa')), put('coffee-table', 2500, 2100, 0, pick('coffee-table')), put('armchair', 900, 1500, 90, pick('armchair')), put('floor-lamp', 4500, 3500, 0, pick('floor-lamp')), put('pouf', 3900, 1300, 0, null)];
      updateModeUI(); fitRoom();
      return { n: P.furniture.length, bad: ids.filter((v) => v && v.err) };
    });
    assert.ok(!built.err && !built.bad.length && built.n === 5, 'план построен: ' + JSON.stringify(built));
    await page.waitForFunction(() => EditorSync.state === 'saved', null, { timeout: 15000 });
    const pid = await page.evaluate(() => EditorSync.id);
    log('комната построена, проект в аккаунте');

    /* 3D (обзор снаружи) → «Визуализация»: своего ракурса нет, предложены ракурсы из углов и от стен */
    await page.click('#btn3d');
    await page.waitForSelector('#btnRender', { state: 'visible' });
    await page.click('#btnRender');
    await page.waitForSelector('#dlg.rnd .rgrid .rcard canvas');
    await page.waitForFunction(() => !renderLoading(), null, { timeout: 30000 });
    await page.waitForTimeout(900); // миниатюры перерисовываются после загрузки моделей
    const setup = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#dlg.rnd .rcard')];
      const ink = (cv) => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4 * 97) seen.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4)); return seen.size; };
      return { names: cards.map((c) => c.querySelector('span').textContent), colors: cards.map((c) => ink(c.querySelector('canvas'))), on: cards.findIndex((c) => c.classList.contains('on')), notes: [...document.querySelectorAll('#dlg .pnote:not([hidden])')].map((n) => n.textContent),
        quota: document.querySelector('#dlg').textContent.match(/осталось визуализаций: (\d+) из (\d+)/)?.slice(1).map(Number), style: !!document.querySelector('#rndStyle') };
    });
    assert.ok(setup.names.length >= 2 && setup.names.every((n) => /^Ракурс \d$/.test(n)), 'предложенные ракурсы: ' + setup.names);
    assert.ok(setup.colors.every((n) => n > 12), 'в миниатюрах нарисована комната, а не пустой кадр: ' + setup.colors);
    assert.equal(setup.on, 0); assert.deepEqual(setup.quota, [4, 4]); assert.equal(setup.style, false, 'стиль выбирать не из чего');
    assert.ok(setup.notes.some((n) => /Пустышки без товара \(1\)/.test(n)), 'предупреждение о пустышке: ' + setup.notes);
    await shot('01-setup');

    /* первая визуализация */
    const sent = page.waitForRequest((r) => r.method() === 'POST' && /\/renders$/.test(r.url()));
    await page.click('#dlg .btns .primary');
    const req = (await sent).postDataJSON();
    assert.equal(req.aspect, '3:2'); assert.equal(req.mood, 'day'); assert.equal(req.anchorId, null);
    assert.deepEqual(req.scene.walls.map((w) => w.type).sort(), ['color', 'texture']); assert.equal(req.scene.windows, 1); assert.equal(req.scene.doors, 1);
    assert.ok(req.scene.area > 15 && req.scene.area < 21, 'площадь комнаты: ' + req.scene.area);
    assert.ok(req.scene.items.length && req.scene.items.every((i) => i.typeId !== 'pouf'), 'в кадре товары, пустышки нет: ' + JSON.stringify(req.scene.items));
    assert.ok(req.refs.length >= 1 && req.refs.length <= 6 && req.refs.every((r) => r.productId && r.data.length > 500), 'фото товаров приложены: ' + req.refs.length);
    await page.waitForSelector('#dlg.rview img.rbig[src]', { timeout: 30000 });
    const first = await page.evaluate(async () => { const im = document.querySelector('#dlg.rview img.rbig'); await im.decode(); return { w: im.naturalWidth, h: im.naturalHeight, title: document.querySelector('#dlg h3').textContent, btns: [...document.querySelectorAll('#dlg .btns button')].map((b) => b.textContent) }; });
    assert.deepEqual([first.w, first.h], [1536, 1024], 'кадр фиксированного размера 3:2');
    assert.deepEqual(first.btns, ['К списку', 'Удалить', 'Скачать', 'Ещё ракурс в этом стиле']);
    let list = (await (await fetch(`${BASE}/api/projects/${pid}/renders`, { headers: auth })).json());
    assert.equal(list.renders.length, 1); assert.deepEqual(list.daily, { limit: 4, left: 3 });
    await shot('02-first');
    /* на заглушке «визуализация» — сам кадр: по нему видно, что именно уходит модели */
    fs.writeFileSync(path.join(SHOTS, 'frame.jpg'), Buffer.from((await (await fetch(`${BASE}/api/projects/${pid}/renders/${list.renders[0].id}`, { headers: auth })).json()).data, 'base64'));
    log('первая визуализация создана: 1536×1024, фото товаров в запросе — ' + req.refs.length);

    /* ещё ракурс в том же стиле, вечером выбрать нельзя — освещение наследуется от образца */
    await page.click('#dlg .btns .primary');
    await page.waitForSelector('#dlg.rnd #rndStyle');
    const second = await page.evaluate(() => ({ style: document.querySelector('#rndStyle').value, moodOff: [...document.querySelectorAll('#dlg .ropts .seg button')].every((b) => b.disabled), on: [...document.querySelectorAll('#dlg.rnd .rsec + .rgrid')].pop().querySelector('.rcard.on span').textContent, ready: document.querySelectorAll('#dlg.rnd .rcard img').length }));
    assert.equal(second.style, list.renders[0].id); assert.equal(second.moodOff, true); assert.equal(second.on, 'Ракурс 2', 'предложен следующий ракурс'); assert.equal(second.ready, 1);
    const sent2 = page.waitForRequest((r) => r.method() === 'POST' && /\/renders$/.test(r.url()));
    await page.click('#dlg .btns .primary');
    assert.equal((await sent2).postDataJSON().anchorId, list.renders[0].id);
    await page.waitForSelector('#dlg.rview img.rbig[src]', { timeout: 30000 });
    list = (await (await fetch(`${BASE}/api/projects/${pid}/renders`, { headers: auth })).json());
    assert.equal(list.renders.length, 2); assert.equal(list.renders[1].anchor, list.renders[0].id);

    /* смета берёт визуализации этой расстановки */
    assert.equal(await page.evaluate(async () => (await renderPrintImages('')).length), 2);
    assert.equal(await page.evaluate(async () => (await renderPrintImages('Вариант 1: другой')).length), 0);

    /* удаление второй; затем вид изнутри — первым предлагается «Текущий вид» */
    await page.click('#dlg .btns .destructive');
    await page.waitForFunction(() => /Удалить визуализацию/.test(document.querySelector('#dlg h3')?.textContent || ''));
    await page.click('#dlg .btns .destructive'); // подтверждение
    await page.waitForSelector('#dlg.rnd .ropts');
    assert.equal((await (await fetch(`${BASE}/api/projects/${pid}/renders`, { headers: auth })).json()).renders.length, 1);
    await page.click('#dlg .btns button:first-child');
    await page.waitForFunction(() => document.querySelector('#overlay').hidden);
    await page.click('#m3dWalk'); await page.waitForTimeout(400);
    await page.click('#btnRender');
    await page.waitForSelector('#dlg.rnd .ropts');
    const walk = await page.evaluate(() => [...[...document.querySelectorAll('#dlg.rnd .rgrid')].pop().querySelectorAll('.rcard span')].map((s) => s.textContent));
    assert.equal(walk[0], 'Текущий вид'); assert.ok(walk.length >= 2);
    await page.click('#dlg .ropts .seg button:nth-child(2)'); // вечером
    const sent3 = page.waitForRequest((r) => r.method() === 'POST' && /\/renders$/.test(r.url()));
    await page.click('#dlg .btns .primary');
    assert.equal((await sent3).postDataJSON().mood, 'evening');
    await page.waitForSelector('#dlg.rview img.rbig[src]', { timeout: 30000 });
    assert.match(await page.textContent('#dlg .summary'), /Вечернее освещение/);
    await page.click('#dlg .btns button:first-child'); await page.waitForSelector('#dlg.rnd .ropts');
    await shot('03-gallery');
    await page.click('#dlg .btns button:first-child');
    /* 3D‑вид после съёмки кадров остался рабочим: размер холста вернулся к размеру окна */
    const canvas = await page.evaluate(() => { const c = document.querySelector('#c3'), r = c.getBoundingClientRect(); return { ratio: c.width / c.height, css: r.width / r.height, labels: [...T3.labels.values()].filter((s) => s.visible).length }; });
    assert.ok(Math.abs(canvas.ratio - canvas.css) < 0.02, '3D‑холст не остался в размере кадра: ' + JSON.stringify(canvas));
    log('второй ракурс в стиле первого, удаление, вечернее освещение, смета — в порядке');

    /* гость по ссылке владельца: только просмотр готовых картинок */
    const share = (await (await fetch(`${BASE}/api/projects/${pid}/share`, { method: 'POST', headers: auth })).json()).token;
    const guestCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const guest = await guestCtx.newPage(); watch(guest);
    await guest.goto(`${BASE}/editor?share=${share}`);
    await guest.waitForFunction(() => window.EditorSync && EditorSync.mode === 'view' && typeof P !== 'undefined' && P.closed, null, { timeout: 30000 });
    await guest.click('#btn3d'); await guest.click('#btnRender');
    await guest.waitForSelector('#dlg.rnd .rcard img[src]', { timeout: 30000 });
    const g = await guest.evaluate(() => ({ cards: document.querySelectorAll('#dlg.rnd .rcard').length, btns: [...document.querySelectorAll('#dlg .btns button')].map((b) => b.textContent), opts: !!document.querySelector('#dlg .ropts') }));
    assert.deepEqual(g, { cards: 2, btns: ['Закрыть'], opts: false });
    await guest.click('#dlg.rnd .rcard'); await guest.waitForSelector('#dlg.rview img.rbig[src]');
    assert.deepEqual(await guest.evaluate(() => [...document.querySelectorAll('#dlg .btns button')].map((b) => b.textContent)), ['К списку', 'Скачать']);
    await shot('04-shared', guest);
    await guestCtx.close();

    assert.deepEqual(errors, [], 'ошибки в консоли браузера');
    console.log('\nE2E пройден. Снимки: ' + SHOTS);
  } catch (e) {
    console.error('\nE2E не пройден:', (e && e.stack) || e);
    if (srvLog) console.error('\n--- журнал сервера ---\n' + srvLog.split('\n').slice(-25).join('\n'));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill();
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
}
main();
