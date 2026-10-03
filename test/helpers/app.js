'use strict';
/* Общий помощник тестов API: ядро на временной SQLite‑базе, письма — в <dir>/outbox, провайдеры входа — подменённый fetch. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, fromEnv, ApiError } = require('../../server/core/app.js');

const ADMIN = { email: 'admin@test.local', password: 'admin-pass-123' };
const GOOD_PW = 'Kv4rtira-plan';

/* profiles: code → профиль провайдера (то, что вернул бы userinfo) */
function fakeProviderFetch(profiles) {
  return async (url, opts = {}) => {
    const u = String(url);
    const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (u.includes('/token')) {
      const code = new URLSearchParams(opts.body).get('code');
      if (!profiles[code]) return json(400, { error: 'invalid_grant' });
      return json(200, { access_token: 'at-' + code });
    }
    if (u.includes('userinfo') || u.includes('login.yandex.ru/info')) {
      const code = String(opts.headers.Authorization || '').replace(/^(Bearer|OAuth) at-/, '');
      return profiles[code] ? json(200, profiles[code]) : json(401, {});
    }
    return json(404, {});
  };
}

function makeApp(env = {}, { profiles } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'furnitech-test-'));
  const app = createApp(async () => ({
    ...(await fromEnv({ ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, SEED_DEMO: '0', MAIL_QUIET: '1', AUTH_PAD_MS: '0', PUBLIC_URL: 'https://furnitech.test', ...env }, { dataDir: dir })),
    ...(profiles ? { fetch: fakeProviderFetch(profiles) } : {}),
  }));
  let ipSeq = 0;
  async function call(method, pathname, { body, token, ip, raw, query, cookie } = {}) {
    const buf = raw != null ? Buffer.from(raw) : Buffer.from(body === undefined ? '' : JSON.stringify(body));
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = 'Bearer ' + token;
    if (cookie) headers.cookie = cookie;
    return app.handle({
      method, pathname, query: query || {}, ip: ip || `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`,
      header: (n) => headers[n.toLowerCase()],
      body: async (limit) => { if (buf.length > limit) throw new ApiError(413, 'too_large', 'too large'); return buf; },
      webRequest: () => null,
    });
  }
  /* Письма из outbox, новые в конце; kind и to — необязательные фильтры */
  function mails(kind, to) {
    const d = path.join(dir, 'outbox');
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).sort().map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')))
      .filter((m) => (!kind || m.kind === kind) && (!to || m.to === to));
  }
  const tokenOf = (mail) => new URL(mail.link).searchParams.get('token');
  const db = async () => (await app.init()).db;
  const reg = (over = {}) => ({ name: 'Анна', email: `anna${Math.random().toString(36).slice(2, 8)}@example.com`, password: GOOD_PW, acceptTerms: true, marketing: false, website: '', ...over });
  async function register(over = {}) {
    const body = reg(over);
    const r = await call('POST', '/api/auth/register', { body });
    if (r.status !== 200) throw new Error('register failed: ' + JSON.stringify(r.body));
    return { ...r.body, email: body.email, password: body.password };
  }
  async function adminToken() { return (await call('POST', '/api/auth/login', { body: ADMIN })).body.token; }
  /* Полный проход входа через провайдера: start → callback → exchange */
  async function oauth(provider, code, { next, tamperState } = {}) {
    const s = await call('GET', `/api/auth/oauth/${provider}/start`, { query: next ? { next } : {} });
    if (s.status !== 302) return { start: s };
    const loc = new URL(s.headers.Location);
    const cookie = String(s.headers['Set-Cookie'] || '').split(';')[0];
    const state = loc.searchParams.get('state');
    const cb = await call('GET', `/api/auth/oauth/${provider}/callback`, { query: { code, state: tamperState ? 'x' + state : state }, cookie });
    const back = new URL(cb.headers.Location);
    const out = { start: s, callback: cb, back, error: back.searchParams.get('oauth_error'), next: back.searchParams.get('next'), code: back.searchParams.get('oauth') };
    if (out.code) out.exchange = await call('POST', '/api/auth/oauth/exchange', { body: { code: out.code } });
    return out;
  }
  return { app, call, dir, mails, tokenOf, db, reg, register, adminToken, oauth };
}

const room = (name = 'Гостиная') => ({
  name, unit: 'mm', closed: true,
  vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 5400, y: 0 }, { id: 'c', x: 5400, y: 3900 }, { id: 'd', x: 0, y: 3900 }],
  walls: [{ id: 'w1', a: 'a', b: 'b' }, { id: 'w2', a: 'b', b: 'c' }, { id: 'w3', a: 'c', b: 'd' }, { id: 'w4', a: 'd', b: 'a' }],
  openings: [], furniture: [], viewport: { x: 0, y: 0, zoom: 0.1 },
});

module.exports = { makeApp, ADMIN, GOOD_PW, room };
