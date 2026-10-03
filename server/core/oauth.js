'use strict';
/* Вход через Google и Яндекс: OAuth 2.0 authorization code + PKCE целиком на сервере (ТЗ этапа 2, раздел 5).
   Состояние между стартом и возвратом хранится в подписанной cookie ft_oauth — таблица в базе не нужна. */
const crypto = require('node:crypto');
const auth = require('./auth.js');
const V = require('../../public/shared/validation.js');

const PROVIDERS = {
  google: {
    label: 'Google', idEnv: 'GOOGLE_CLIENT_ID', secretEnv: 'GOOGLE_CLIENT_SECRET',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
    userUrl: 'https://openidconnect.googleapis.com/v1/userinfo', scope: 'openid email profile',
    extra: { prompt: 'select_account', access_type: 'online' },
    authHeader: (t) => 'Bearer ' + t,
    /* почта принимается только подтверждённая */
    profile: (j) => ({ subject: String(j.sub || ''), email: (j.email_verified === true || j.email_verified === 'true') && j.email ? String(j.email) : null, name: String(j.name || j.given_name || '') }),
  },
  yandex: {
    label: 'Яндекс', idEnv: 'YANDEX_CLIENT_ID', secretEnv: 'YANDEX_CLIENT_SECRET',
    authUrl: 'https://oauth.yandex.ru/authorize', tokenUrl: 'https://oauth.yandex.ru/token',
    userUrl: 'https://login.yandex.ru/info?format=json', scope: 'login:email login:info',
    extra: {},
    authHeader: (t) => 'OAuth ' + t,
    /* default_email — ящик Яндекса, считается подтверждённым */
    profile: (j) => ({ subject: String(j.id || ''), email: j.default_email ? String(j.default_email) : null, name: String(j.real_name || j.display_name || j.first_name || '') }),
  },
};
const COOKIE = 'ft_oauth';
const STATE_TTL = 600; // секунд
const b64 = (buf) => Buffer.from(buf).toString('base64url');

class OAuthError extends Error { constructor(code) { super(code); this.code = code; } }

function makeOAuth(ctx, { baseUrl, secret, audit, registrationOpen }) {
  const env = ctx.env || {};
  const doFetch = (...a) => (ctx.fetch || globalThis.fetch)(...a);
  const enabled = (p) => !!(PROVIDERS[p] && env[PROVIDERS[p].idEnv] && env[PROVIDERS[p].secretEnv]);
  const redirectUri = (p) => `${baseUrl}/api/auth/oauth/${p}/callback`;
  const sign = (payload) => crypto.createHmac('sha256', secret).update('oauth:' + payload).digest('base64url');
  const secure = baseUrl.startsWith('https://') ? '; Secure' : '';
  const cookie = (value, maxAge) => `${COOKIE}=${value}; Max-Age=${maxAge}; Path=/api/auth/oauth; HttpOnly; SameSite=Lax${secure}`;
  const clearCookie = () => cookie('', 0);

  function readCookie(header) {
    const m = new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)').exec(String(header || ''));
    if (!m) return null;
    const [payload, sig] = m[1].split('.');
    if (!payload || !sig) return null;
    const exp = Buffer.from(sign(payload)); const got = Buffer.from(sig);
    if (exp.length !== got.length || !crypto.timingSafeEqual(exp, got)) return null;
    try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  }

  return {
    enabled,
    list: () => ({ google: enabled('google'), yandex: enabled('yandex') }),
    clearCookie,

    /* Шаг 1: адрес страницы провайдера и cookie с state, PKCE‑ключом и next */
    start(provider, nextRaw) {
      if (!enabled(provider)) throw new OAuthError('disabled');
      const P = PROVIDERS[provider];
      const state = b64(crypto.randomBytes(16)); const verifier = b64(crypto.randomBytes(32));
      const next = nextRaw ? V.safeNext(nextRaw, '') : '';
      const payload = b64(JSON.stringify({ s: state, v: verifier, n: next, p: provider, t: Date.now() }));
      const q = new URLSearchParams({ client_id: env[P.idEnv], redirect_uri: redirectUri(provider), response_type: 'code', scope: P.scope, state,
        code_challenge: b64(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', ...P.extra });
      return { url: P.authUrl + '?' + q, cookie: cookie(payload + '.' + sign(payload), STATE_TTL) };
    },

    /* Шаг 2: проверить state, обменять code на токен, получить профиль → {profile, next} */
    async callback(provider, query, cookieHeader) {
      if (!enabled(provider)) throw new OAuthError('disabled');
      const P = PROVIDERS[provider];
      if (query.error) throw new OAuthError(query.error === 'access_denied' ? 'cancelled' : 'provider');
      const st = readCookie(cookieHeader);
      if (!st || st.p !== provider || !query.state || st.s !== query.state || Date.now() - Number(st.t) > STATE_TTL * 1000) throw new OAuthError('state');
      if (!query.code) throw new OAuthError('provider');
      let profile;
      try {
        const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 8000);
        try {
          const tr = await doFetch(P.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, signal: ctl.signal,
            body: new URLSearchParams({ grant_type: 'authorization_code', code: String(query.code), client_id: env[P.idEnv], client_secret: env[P.secretEnv], redirect_uri: redirectUri(provider), code_verifier: st.v }).toString() });
          if (!tr.ok) throw new Error('token ' + tr.status);
          const tj = await tr.json();
          if (!tj.access_token) throw new Error('no access_token');
          const ur = await doFetch(P.userUrl, { headers: { Authorization: P.authHeader(tj.access_token), Accept: 'application/json' }, signal: ctl.signal });
          if (!ur.ok) throw new Error('userinfo ' + ur.status);
          profile = P.profile(await ur.json());
        } finally { clearTimeout(timer); }
      } catch (e) { console.error(`OAuth ${provider}: ${e.message}`); throw new OAuthError('provider'); }
      if (!profile.subject) throw new OAuthError('provider');
      return { profile, next: st.n ? V.safeNext(st.n, '') : '' };
    },

    /* Шаг 3: какой аккаунт открывается (ТЗ 5.3) → {user, created} */
    async resolve(provider, profile, attempt = 0) {
      const db = ctx.db; const now = new Date().toISOString();
      const ident = await db.get('SELECT * FROM user_identities WHERE provider=? AND subject=?', [provider, profile.subject]);
      if (ident) {
        const u = await db.get('SELECT * FROM users WHERE id=?', [ident.user_id]);
        if (u) { if (Number(u.disabled)) throw new OAuthError('blocked'); return { user: u, created: false }; }
      }
      const email = V.normEmail(profile.email);
      if (!profile.email || V.validateEmail(email)) throw new OAuthError('no_email');
      const link = async (userId) => {
        try { await db.run('INSERT INTO user_identities (provider,subject,user_id,email,created_at) VALUES (?,?,?,?,?)', [provider, profile.subject, userId, email, now]); return true; }
        catch (e) { if (/unique|duplicate|constraint/i.test(e.message)) return false; throw e; }
      };
      const existing = await db.get('SELECT * FROM users WHERE email=?', [email]);
      if (existing) {
        if (Number(existing.disabled)) throw new OAuthError('blocked');
        if (existing.role === 'admin') throw new OAuthError('use_password');
        if (!(await link(existing.id)) && attempt < 1) return this.resolve(provider, profile, attempt + 1);
        if (!existing.email_verified_at) {
          /* защита от перехвата: кто‑то мог заранее зарегистрировать чужой адрес со своим паролем */
          await db.run('UPDATE users SET password_hash=?, email_verified_at=?, updated_at=? WHERE id=?', [auth.NO_PASSWORD, now, now, existing.id]);
          await db.run('DELETE FROM sessions WHERE user_id=?', [existing.id]);
          await db.run('DELETE FROM auth_tokens WHERE user_id=?', [existing.id]);
          await audit(existing.id, 'user.oauth_link', 'user', existing.id, { provider, passwordReset: true });
        } else await audit(existing.id, 'user.oauth_link', 'user', existing.id, { provider });
        return { user: await db.get('SELECT * FROM users WHERE id=?', [existing.id]), created: false };
      }
      if (!registrationOpen()) throw new OAuthError('registration_closed');
      let name = V.normName(profile.name);
      if (V.validateName(name)) name = V.normName(email.split('@')[0].replace(/[^\p{L}\p{N} ._-]/gu, ' '));
      if (V.validateName(name)) name = 'Пользователь';
      let id;
      try {
        id = await auth.createUser(db, { email, password: null, role: 'client', name, verified: true, terms: { acceptedAt: now, version: V.TERMS_VERSION } });
      } catch (e) {
        if (/unique|duplicate|constraint/i.test(e.message) && attempt < 1) return this.resolve(provider, profile, attempt + 1); // параллельный первый вход
        throw e;
      }
      await link(id);
      await audit(id, 'user.oauth_register', 'user', id, { provider });
      return { user: await db.get('SELECT * FROM users WHERE id=?', [id]), created: true };
    },
  };
}

module.exports = { makeOAuth, OAuthError, PROVIDERS };
