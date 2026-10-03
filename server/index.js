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

/* Страницы сайта — те же соответствия, что rewrites в vercel.json */
const PAGES = { '/': 'index.html', '/editor': 'editor.html', '/login': 'auth.html', '/register': 'auth.html', '/forgot': 'auth.html', '/reset': 'auth.html', '/verify': 'auth.html',
  '/projects': 'projects.html', '/account': 'account.html', '/terms': 'legal.html', '/privacy': 'legal.html', '/admin': 'admin.html' };
/* Заголовки безопасности для HTML (CSP пока в режиме Report-Only — см. ТЗ, раздел 10.3) */
const SECURITY = {
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy-Report-Only': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://*.public.blob.vercel-storage.com; connect-src 'self' https://*.public.blob.vercel-storage.com https://vercel.com https://cdn.jsdelivr.net; frame-ancestors 'none'",
};

function serveFile(res, base, rel, extra = {}, status = 200) {
  let file;
  try { file = path.resolve(base, '.' + path.posix.normalize('/' + decodeURIComponent(rel))); } catch { res.writeHead(400).end(); return; }
  if (!file.startsWith(base + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      if (status !== 404 && base === PUBLIC) return serveFile(res, PUBLIC, '404.html', SECURITY, 404);
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found'); return;
    }
    if (path.extname(file) === '.html') extra = { ...SECURITY, ...extra };
    res.writeHead(status, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'X-Content-Type-Options': 'nosniff', ...extra });
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
      method: req.method, pathname: p, query: Object.fromEntries(url.searchParams), ip: req.socket.remoteAddress,
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
  /* страница со слэшем на конце → без слэша: относительные пути страниц рассчитаны на адрес без него */
  if (p.length > 1 && p.endsWith('/') && PAGES[p.replace(/\/+$/, '')]) { res.writeHead(301, { Location: p.replace(/\/+$/, '') + url.search }).end(); return; }
  const page = PAGES[p];
  if (page) return serveFile(res, PUBLIC, page);
  return serveFile(res, PUBLIC, p.slice(1));
});

app.init().then(() => server.listen(PORT, () => console.log(`Главная: http://localhost:${PORT}/   Редактор: http://localhost:${PORT}/editor   Админ‑панель: http://localhost:${PORT}/admin`)))
  .catch(e => { console.error('Не удалось запустить:', e.message); process.exit(1); });
