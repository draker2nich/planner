'use strict';
/* Локальный сервер. Node ≥ 22.5, без внешних пакетов (SQLite и файлы в ./data).
   Запуск: node server/index.js   (порт PORT, по умолчанию 8080)
   Если заданы DATABASE_URL / BLOB_READ_WRITE_TOKEN — работает с Neon и Vercel Blob (нужен npm install). */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createApp, fromEnv, ApiError } = require('./core/app.js');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const PORT = +process.env.PORT || 8080;

const app = createApp(() => fromEnv(process.env, { dataDir: DATA }));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

function serveFile(res, base, rel, extra = {}) {
  let file;
  try { file = path.resolve(base, '.' + path.posix.normalize('/' + decodeURIComponent(rel))); } catch { res.writeHead(400).end(); return; }
  if (!file.startsWith(base + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'X-Content-Type-Options': 'nosniff', ...extra });
    fs.createReadStream(file).pipe(res);
  });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const tooBig = () => Object.assign(new Error(`Файл больше ${Math.round(limit / 1048576)} МБ`), { status: 413 });
    if (+req.headers['content-length'] > limit) { req.resume(); return reject(tooBig()); }
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { req.destroy(); reject(tooBig()); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  if (p.startsWith('/api/')) {
    let bodyP = null;
    const r = await app.handle({
      method: req.method, pathname: p, query: Object.fromEntries(url.searchParams),
      header: (n) => req.headers[n.toLowerCase()],
      body: async (limit) => { try { return await (bodyP ||= readBody(req, limit)); } catch (e) { throw new ApiError(e.status || 400, 'too_large', e.message); } },
      webRequest: () => new Request('http://localhost' + req.url, { method: req.method, headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string') }),
    });
    const data = Buffer.from(JSON.stringify(r.body));
    res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, ...(r.headers || {}) });
    return res.end(data);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  if (p.startsWith('/files/')) return serveFile(res, path.join(DATA, 'uploads'), p.slice(7), { 'Cache-Control': 'public, max-age=31536000, immutable' });
  if (p === '/admin' || p === '/admin/') return serveFile(res, PUBLIC, 'admin.html');
  if (p === '/') return serveFile(res, PUBLIC, 'index.html');
  return serveFile(res, PUBLIC, p.slice(1));
});

app.init().then(() => server.listen(PORT, () => console.log(`Редактор: http://localhost:${PORT}/   Админ‑панель: http://localhost:${PORT}/admin`)))
  .catch(e => { console.error('Не удалось запустить:', e.message); process.exit(1); });
