'use strict';
/* Сквозная проверка ИИ‑дизайнера в браузере на заглушке модели (AI_MOCK=1): мастер → генерация → экран результата →
   переключение вариантов → доработка → «заново» → выбор → перезагрузка страницы.
   Запуск:  cd tools/ai-eval && npm install && npx playwright install chromium && npm run e2e
   Переменные:
     PLAYWRIGHT_PATH  путь к уже установленному пакету playwright (если он стоит не в tools/ai-eval)
     E2E_CDN_DIR      больше не нужна: three.js лежит в проекте (public/vendor/three-r128); переменная оставлена для старых веток
     E2E_SHOTS        куда складывать снимки экрана (по умолчанию tools/ai-eval/shots)
     E2E_HEADED=1     показать окно браузера */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const ROOT = path.join(__dirname, '..', '..');
const PORT = 8700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'shots');
const CDN = process.env.E2E_CDN_DIR || '';
const log = (...a) => console.log('·', ...a);

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-e2e-'));
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, AI_MOCK: '1', MAIL_MODE: 'off', AUTH_PAD_MS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let srvLog = ''; srv.stdout.on('data', d => { srvLog += d; }); srv.stderr.on('data', d => { srvLog += d; });
  let browser;
  try {
    for (let i = 0; ; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.ok) break; } catch {} if (i > 150) throw new Error('сервер не поднялся:\n' + srvLog); await new Promise(r => setTimeout(r, 200)); }
    const reg = await (await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Проверка', email: 'e2e@example.test', password: 'correct horse battery 42', acceptTerms: true }) })).json();
    assert.ok(reg.token, 'регистрация: ' + JSON.stringify(reg));
    const cfg = await (await fetch(BASE + '/api/config')).json();
    assert.deepEqual(cfg.ai, { enabled: true, mock: true, dailyRuns: 10 });

    browser = await chromium.launch({ headless: !process.env.E2E_HEADED });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    if (CDN) {
      const local = { 'three.min.js': 'three.min.js', 'GLTFLoader.js': 'GLTFLoader.js', 'meshopt_decoder.js': 'meshopt_decoder.js' };
      await ctx.route(/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net/, (route) => { const f = local[path.basename(new URL(route.request().url()).pathname)]; return f ? route.fulfill({ path: path.join(CDN, f), contentType: 'text/javascript' }) : route.abort(); });
      await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    }
    await ctx.addInitScript((t) => { try { localStorage.setItem('planner.token', t); } catch {} }, reg.token);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e && e.stack || e))); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
    const shot = (name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
    await page.goto(BASE + '/editor');
    await page.waitForFunction(() => window.EditorSync && EditorSync.mode === 'account' && EditorSync.id && typeof CATALOG_SOURCE !== 'undefined' && CATALOG_SOURCE === 'server', null, { timeout: 30000 });
    log('редактор открыт, каталог загружен');

    /* комната 5×4 м с окном и дверью и мебель: часть товарами, часть пустышками */
    const built = await page.evaluate(() => {
      const err = apply(Q => {
        Q.vertices = [{ id: 'v1', x: 0, y: 0 }, { id: 'v2', x: 5000, y: 0 }, { id: 'v3', x: 5000, y: 4000 }, { id: 'v4', x: 0, y: 4000 }];
        Q.walls = [{ id: 'w1', a: 'v1', b: 'v2' }, { id: 'w2', a: 'v2', b: 'v3' }, { id: 'w3', a: 'v3', b: 'v4' }, { id: 'w4', a: 'v4', b: 'v1' }];
        Q.openings = [{ id: 'o1', kind: 'window', name: 'Окно 1', wallId: 'w1', offset: 1700, width: 1500, height: 1400, sill: 900 }, { id: 'o2', kind: 'door', name: 'Дверь 1', wallId: 'w3', offset: 400, width: 900, height: 2000, hinge: 'left', swing: 'in' }];
        Q.wallParamsSet = true; Q.seq = { door: 1, window: 1, arch: 0 };
      });
      if (err) return { err };
      setMode('furniture');
      const pick = (typeId) => PRODUCTS.find(p => p.typeId === typeId);
      const put = (typeId, x, y, rot, product, extra) => { const t = TYPE.get(typeId); const f = Object.assign(makeFurniture(t, (product ? product.formId : t.forms[0].id), {}, product || null, false), { x, y, rot }, extra || {}); const e = apply(Q => { Q.furniture.push(f); if (!f.productId) Q.fseq[t.id] = (Q.fseq[t.id] || 0) + 1; refreshWarnings(Q); Q._strict = [f.id]; }); return e ? { err: typeId + ': ' + e } : f.id; };
      const ids = {};
      const ward = pick('wardrobe');
      ids.ward = put('wardrobe', 5000 - ward.dims.D / 2, 400 + ward.dims.W / 2, 90, ward, { locked: true });   // товар под замком у правой стены → «Ничего»
      ids.sofa = put('sofa', 2500, 2300, 0, null);              // пустышки посреди комнаты → «Двигать и заменять»
      ids.table = put('coffee-table', 2500, 1100, 0, null);
      ids.arm1 = put('armchair', 900, 1000, 0, null);
      ids.arm2 = put('armchair', 900, 2600, 0, null);
      ids.rug = put('rug', 3300, 3100, 0, null);
      updateModeUI(); fitRoom();
      return { ids, n: P.furniture.length, bad: Object.values(ids).filter(v => v && v.err) };
    });
    assert.ok(!built.err && !built.bad.length, 'план построен: ' + JSON.stringify(built));
    await shot('01-plan');

    /* мастер: права */
    await page.click('#btnFinish');
    await page.waitForSelector('#dlg .aitable');
    const rights = await page.evaluate(() => [...document.querySelectorAll('#dlg .airow')].map(r => ({ name: r.querySelector('.nm').firstChild.textContent, on: r.querySelector('.seg .on')?.textContent, off: [...r.querySelectorAll('.seg button:disabled')].map(b => b.textContent) })));
    assert.equal(rights[0].on, 'Ничего', 'запертый товар — «Ничего»');
    assert.equal(rights[1].on, 'Двигать и заменять');
    assert.deepEqual(rights[1].off, ['Ничего', 'Двигать'], 'у пустышки нет «Ничего» и «Двигать»');
    assert.equal(await page.locator('#dlg .aistate .err').count(), 0, 'препятствий для запуска нет: ' + await page.locator('#dlg .aistate').innerText());
    await page.click('#dlg .roomblk .seg >> nth=0 >> text=На усмотрение ИИ');   // стены
    await shot('02-rights');
    await page.click('#dlg .btns button.primary');
    /* мастер: пожелания */
    await page.waitForSelector('#dlg textarea');
    assert.equal(await page.locator('#dlg .chips >> nth=0 >> .chip').count(), 12, 'все стили словаря и «Неважно»');
    await page.click('#dlg .chip:has-text("Скандинавский")');
    await page.fill('#dlg textarea', 'Светлая гостиная, диван напротив окна, побольше дерева');
    await shot('03-wishes');
    await page.click('#dlg .btns button.primary');
    /* генерация и экран результата */
    await page.waitForSelector('#result .aivar', { timeout: 60000 });
    await page.waitForTimeout(300);
    await shot('04-result');
    const res = await page.evaluate(() => ({ status: P.status, active: P.ai.active, n: P.ai.variants.length, failed: P.ai.variants.map(v => v.failed || null), titles: P.ai.variants.map(v => v.title),
      filled: P.ai.variants.map(v => (v.furniture || []).filter(f => f.productId).length), base: P.ai.base.furniture.filter(f => f.productId).length, stats: P.ai.variants.map(v => v.stats), warnings: P.ai.variants.map(v => v.warnings),
      screenIsBase: JSON.stringify(P.furniture.map(f => [f.id, f.productId, f.x, f.y])) === JSON.stringify(P.ai.base.furniture.map(f => [f.id, f.productId, f.x, f.y])), hist: hist.length, runsLeft: AI_RUNS_LEFT,
      walls: P.ai.variants.map(v => v.finishes && Object.values(v.finishes.walls)[0]), cards: document.querySelectorAll('#result .aivar').length }));
    log('результат:', JSON.stringify(res));
    assert.equal(res.status, 'submitted'); assert.equal(res.n, 2); assert.deepEqual(res.failed, [null, null]); assert.equal(res.cards, 3);
    assert.deepEqual(res.filled, [6, 6], 'все пустышки получили товары'); assert.equal(res.base, 1); assert.ok(res.screenIsBase, 'на плане — исходная расстановка');
    assert.equal(res.hist, 1, 'история отмены сброшена'); assert.equal(res.runsLeft, 9);
    assert.ok(res.walls[0] && res.walls[1], 'отделка стен выбрана в обоих вариантах');
    /* права соблюдены: запертый шкаф не тронут ни в одном варианте */
    const kept = await page.evaluate((id) => { const b = P.ai.base.furniture.find(f => f.id === id); return P.ai.variants.map(v => { const f = v.furniture.find(x => x.id === id); return f.productId === b.productId && f.x === b.x && f.y === b.y && f.rot === b.rot; }); }, built.ids.ward);
    assert.deepEqual(kept, [true, true]);
    /* расстановка каждого варианта проходит проверку редактора */
    const valid = await page.evaluate(() => P.ai.variants.map(v => { const Q = Object.assign({}, P, { furniture: v.furniture, mode: 'furniture', _strict: v.furniture.map(f => f.id) }); return validateFurniture(Q, D); }));
    assert.deepEqual(valid, [null, null]);

    /* открыть второй вариант на плане, переключиться полосой, вернуться к вариантам */
    await page.click('#result .aivar[data-cell="1"] >> text=Открыть план');
    await page.waitForSelector('#aiBar:not([hidden])');
    assert.deepEqual(await page.evaluate(() => [P.ai.active, P.status, P.furniture.filter(f => f.productId).length, document.querySelector('#result').hidden]), [1, 'draft', 6, true]);
    await shot('05-variant-on-plan');
    /* правка в варианте остаётся в варианте */
    const moved = await page.evaluate((id) => { const f = P.furniture.find(x => x.id === id); const err = fUpdate(id, q => { q.rot = (q.rot + 180) % 360; }); return { err, rot: P.furniture.find(x => x.id === id).rot, was: f.rot }; }, built.ids.rug);
    assert.equal(moved.err, null);
    await page.click('#aiBar .seg button >> nth=0');
    assert.deepEqual(await page.evaluate(() => [P.ai.active, P.furniture.filter(f => f.productId).length]), ['base', 1]);
    await page.click('#aiBar .seg button >> nth=2');
    assert.equal(await page.evaluate((id) => P.furniture.find(x => x.id === id).rot, built.ids.rug), moved.rot, 'ручная правка сохранилась в клетке варианта');
    /* Ctrl+Z не уводит в чужой вариант: история началась заново при переключении */
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => P.ai.active), 1);
    if (await page.evaluate(() => typeof THREE !== 'undefined' && hasWebGL)) {
      await page.evaluate(() => enter3D(0));
      await page.waitForTimeout(1200); await shot('06-variant-3d');
      await page.click('#aiBar .seg button >> nth=1'); await page.waitForTimeout(600);
      assert.equal(await page.evaluate(() => P.ai.active), 0, 'варианты переключаются и в 3D');
      await page.evaluate(() => exit3D());
    } else log('3D недоступно в этом окружении — шаг пропущен');
    /* правка, сделанная на плане, видна в карточке своего варианта */
    await page.click('#aiBar .seg button >> nth=2');
    const rot2 = await page.evaluate((id) => { fUpdate(id, q => { q.rot = (q.rot + 90) % 360; }); return P.furniture.find(x => x.id === id).rot; }, built.ids.rug);
    await page.click('#aiBar >> text=К вариантам');
    await page.waitForSelector('#result .aivar');
    assert.equal(await page.evaluate((id) => P.ai.variants[1].furniture.find(x => x.id === id).rot, built.ids.rug), rot2, 'клетка варианта обновлена перед показом экрана результата');

    /* доработка: две новые версии от варианта, прежние можно вернуть */
    const before = await page.evaluate(() => P.ai.variants.map(v => v.id));
    await page.click('#result .aivar[data-cell="1"] >> text=Доработать');
    await page.fill('#dlg textarea', 'Кресла поставить ближе к окну');
    await page.click('#dlg .btns button.primary');
    await page.waitForFunction((ids) => P.ai && P.ai.prevVariants && P.ai.variants[0].id !== ids[0] && !document.querySelector('#overlay:not([hidden]) .aiprog'), before, { timeout: 60000 });
    const ref = await page.evaluate(() => ({ from: P.ai.variants.map(v => v.from), failed: P.ai.variants.map(v => v.failed || null), prev: P.ai.prevVariants.map(v => v.id), active: P.ai.active, runsLeft: AI_RUNS_LEFT }));
    assert.deepEqual(ref.from, ['refine', 'refine']); assert.deepEqual(ref.failed, [null, null]); assert.deepEqual(ref.prev, before); assert.equal(ref.active, 'base'); assert.equal(ref.runsLeft, 8);
    await shot('07-refined');
    await page.click('#result .acts >> text=Вернуть прежние варианты');
    assert.deepEqual(await page.evaluate(() => P.ai.variants.map(v => v.id)), before);

    /* заново: от исходной расстановки */
    await page.click('#result .acts >> text=Сгенерировать заново');
    await page.click('#dlg .btns button.primary');
    await page.waitForFunction((ids) => P.ai && P.ai.variants[0].id !== ids[0] && P.ai.variants[0].from === 'again' && !document.querySelector('#overlay:not([hidden]) .aiprog'), before, { timeout: 60000 });
    assert.deepEqual(await page.evaluate(() => P.ai.variants.map(v => v.failed || null)), [null, null]);

    /* выбор варианта и перезагрузка страницы */
    await page.click('#result .aivar[data-cell="0"] >> text=Выбрать этот вариант');
    assert.equal(await page.evaluate(() => P.ai.chosen), 0);
    assert.equal(await page.locator('#result .aivar.chosen').count(), 1);
    await shot('08-chosen');
    await page.waitForFunction(() => /Сохранено|аккаунт/i.test(document.querySelector('#saveInd').textContent) && !EditorSync.inflight && !EditorSync.timer, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.reload();
    await page.waitForSelector('#result .aivar.chosen', { timeout: 30000 });
    assert.deepEqual(await page.evaluate(() => [P.ai.chosen, P.ai.variants.length, P.status]), [0, 2, 'submitted']);
    log('после перезагрузки варианты на месте');

    /* переход к стенам удаляет варианты только с подтверждением */
    await page.click('#result .acts >> text=К плану');
    await page.click('#modeWalls');
    await page.waitForSelector('#dlg h3:has-text("Изменить комнату?")');
    await page.click('#dlg .btns button:has-text("Отмена")');
    assert.equal(await page.evaluate(() => !!P.ai && P.mode), 'furniture');
    await page.click('#modeWalls'); await page.click('#dlg .btns button:has-text("Перейти к стенам")');
    await page.waitForFunction(() => P.mode === 'walls');
    assert.equal(await page.evaluate(() => P.ai), null);
    assert.equal(await page.locator('#aiBar:not([hidden])').count(), 0);

    /* журнал: три шага на генерацию, без текстов заказчика */
    assert.deepEqual(errors, [], 'ошибок в консоли нет');
    console.log('\nE2E пройден. Снимки: ' + SHOTS);
  } catch (e) {
    console.error('\nE2E не пройден:', e && e.stack || e);
    if (srvLog) console.error('\n--- журнал сервера ---\n' + srvLog.split('\n').slice(-25).join('\n'));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill();
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
}
main();
