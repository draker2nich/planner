'use strict';
/* Локальный сервер (server/index.js) как процесс: некорректные адреса не останавливают его, статика кэшируется и сжимается. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const zlib = require('node:zlib');

const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
/* запрос «как есть»: fetch и URL исправили бы некорректный путь раньше сервера */
const raw = (port, target, headers = {}) => new Promise((resolve, reject) => {
  const sock = net.connect(port, '127.0.0.1'); const chunks = [];
  sock.setTimeout(5000, () => { sock.destroy(); reject(new Error('таймаут: ' + target)); });
  sock.on('error', reject); sock.on('data', (c) => chunks.push(c));
  sock.on('end', () => {
    const buf = Buffer.concat(chunks); const cut = buf.indexOf('\r\n\r\n'); const head = buf.subarray(0, cut).toString('latin1').split('\r\n');
    const h = {}; for (const l of head.slice(1)) { const i = l.indexOf(':'); h[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim(); }
    resolve({ status: Number(head[0].split(' ')[1]), headers: h, body: buf.subarray(cut + 4) });
  });
  sock.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n`);
});

test('локальный сервер: некорректные адреса дают 400, сервер продолжает работать; статика — с ETag и gzip', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-srv-'));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, SEED_DEMO: '0', MAIL_QUIET: '1', NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  t.after(() => { child.kill(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} });
  for (let i = 0; i < 120 && !/Главная:/.test(log); i++) { if (child.exitCode != null) break; await new Promise((r) => setTimeout(r, 250)); }
  assert.match(log, /Главная:/, 'сервер запустился: ' + log.slice(-400));
  assert.ok(!/Администратор создан: \S+ \/ /.test(log), 'пароль администратора в журнал не выводится');

  for (const target of ['/%00', '/files/%00', '//[', '/%', '/api/projects/%E0%A4%A', '/..%2f..%2fetc/passwd']) {
    const r = await raw(port, target);
    assert.ok([400, 401, 403, 404].includes(r.status), `${target} → ${r.status}`);
  }
  assert.equal(child.exitCode, null, 'процесс жив после некорректных запросов');
  const health = await raw(port, '/api/health');
  assert.deepEqual([health.status, JSON.parse(health.body.toString()).ok], [200, true]);

  const page = await raw(port, '/editor');
  assert.equal(page.status, 200);
  assert.ok(page.headers.etag && page.headers['last-modified'], 'есть отметки для повторной проверки');
  assert.equal(page.headers['cache-control'], 'no-cache');
  assert.ok(page.headers['content-security-policy-report-only'], 'политика безопасности — в режиме отчёта');
  assert.equal((await raw(port, '/editor', { 'If-None-Match': page.headers.etag })).status, 304);
  const gz = await raw(port, '/shared/ui.css', { 'Accept-Encoding': 'gzip' });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.ok(zlib.gunzipSync(gz.body).toString().includes('@font-face'), 'сжатый ответ распаковывается в исходный файл');
  const plain = await raw(port, '/shared/ui.css');
  assert.ok(gz.body.length < plain.body.length / 2, 'сжатие заметно уменьшает ответ');
  assert.match((await raw(port, '/vendor/three-r128/three.min.js', { 'Accept-Encoding': 'gzip' })).headers['cache-control'], /immutable/);
  assert.equal((await raw(port, '/shared/fonts/inter-cyrillic-wght-normal.woff2')).headers['content-type'], 'font/woff2');

  const cat = await raw(port, '/api/catalog/products?limit=5');
  assert.equal(cat.status, 200);
  const again = await raw(port, '/api/catalog/products?limit=5', { 'If-None-Match': cat.headers.etag });
  assert.deepEqual([again.status, again.body.length], [304, 0], 'каталог без изменений — ответ без тела');
});
