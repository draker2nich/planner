'use strict';
/* Ограничение частоты запросов. На Vercel у вызовов функции нет общей памяти,
   поэтому счётчики живут в таблице rate_limits (одна строка на ключ, фиксированное окно).
   Сбой лимитера не ломает вход и регистрацию (fail‑open): ошибка пишется в лог, запрос пропускается.
   Для платных вызовов (ИИ‑дизайнер) нужно обратное: take и peek/hit с opts.strict бросают ошибку, и запрос отклоняется. */
const crypto = require('node:crypto');

const iso = (ms) => new Date(ms).toISOString();

function makeLimiter(db, secret) {
  const tag = (s) => crypto.createHmac('sha256', secret).update(String(s)).digest('hex').slice(0, 32);

  async function read(key, limit, windowSec) {
    const row = await db.get('SELECT window_start, count FROM rate_limits WHERE key=?', [key]);
    if (!row) return { ok: true, count: 0, retryAfter: 0 };
    const start = Date.parse(row.window_start); const end = start + windowSec * 1000; const n = Number(row.count);
    if (end <= Date.now()) return { ok: true, count: 0, retryAfter: 0 };
    return { ok: n < limit, count: n, retryAfter: Math.max(1, Math.ceil((end - Date.now()) / 1000)) };
  }
  return {
    tag,
    /* Проверить, не исчерпан ли лимит, не увеличивая счётчик */
    async peek(key, limit, windowSec, opts) {
      try { return await read(key, limit, windowSec); } catch (e) { console.error('rate limit:', e.message); if (opts && opts.strict) throw e; return { ok: true, retryAfter: 0 }; }
    },
    /* Засчитать попытку; ok=false, если она превысила лимит */
    async hit(key, limit, windowSec, opts) {
      try {
        const now = Date.now(); const cutoff = iso(now - windowSec * 1000);
        await db.run(`INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
          ON CONFLICT (key) DO UPDATE SET
            count = CASE WHEN rate_limits.window_start < ? THEN 1 ELSE rate_limits.count + 1 END,
            window_start = CASE WHEN rate_limits.window_start < ? THEN excluded.window_start ELSE rate_limits.window_start END`,
        [key, iso(now), cutoff, cutoff]);
        const r = await read(key, limit + 1, windowSec); // после увеличения: допустимо ровно limit попыток
        if (Math.random() < 0.02) db.run('DELETE FROM rate_limits WHERE window_start < ?', [iso(now - 864e5)]).catch(() => {});
        return { ok: r.count <= limit, count: r.count, retryAfter: r.retryAfter };
      } catch (e) { console.error('rate limit:', e.message); if (opts && opts.strict) throw e; return { ok: true, retryAfter: 0 }; }
    },
    /* Засчитать попытку и узнать её номер одним запросом к базе: параллельные запросы получают разные номера,
       поэтому лимит нельзя обойти, отправив их одновременно. Сбой базы — ошибка (для платных вызовов отказ безопаснее пропуска). */
    async take(key, limit, windowSec) {
      const now = Date.now(); const cutoff = iso(now - windowSec * 1000);
      const row = await db.get(`INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
        ON CONFLICT (key) DO UPDATE SET
          count = CASE WHEN rate_limits.window_start < ? THEN 1 ELSE rate_limits.count + 1 END,
          window_start = CASE WHEN rate_limits.window_start < ? THEN excluded.window_start ELSE rate_limits.window_start END
        RETURNING count, window_start`, [key, iso(now), cutoff, cutoff]);
      const n = Number(row.count); const end = Date.parse(row.window_start) + windowSec * 1000;
      if (Math.random() < 0.02) db.run('DELETE FROM rate_limits WHERE window_start < ?', [iso(now - 864e5)]).catch(() => {});
      return { ok: n <= limit, count: n, retryAfter: Math.max(1, Math.ceil((end - now) / 1000)) };
    },
    /* Вернуть одну засчитанную попытку (платный вызов не состоялся) */
    async undo(key) { try { await db.run('UPDATE rate_limits SET count = count - 1 WHERE key = ? AND count > 0', [key]); } catch (e) { console.error('rate limit:', e.message); } },
    async reset(key) { try { await db.run('DELETE FROM rate_limits WHERE key=?', [key]); } catch {} },
    /* Сбросить все ключи с данным окончанием, например счётчики входа одной почты со всех адресов */
    async resetSuffix(prefix, suffix) { try { await db.run("DELETE FROM rate_limits WHERE key LIKE ? ESCAPE '\\'", [prefix + '%' + suffix]); } catch (e) { console.error('rate limit:', e.message); } },
  };
}

/* Адрес клиента для лимитов.
   server/index.js (локально и на своём сервере) определяет адрес сам и ставит ipResolved — заголовкам здесь не верим:
   без обратного прокси их присылает сам клиент и мог бы обходить лимиты.
   На Vercel адрес приходит в x-forwarded-for, который выставляет платформа. */
function clientIp(req) {
  if (req.ipResolved) return req.ip || 'unknown';
  const xf = req.header('x-forwarded-for');
  if (xf) return String(xf).split(',')[0].trim();
  return req.header('x-real-ip') || req.ip || 'unknown';
}

module.exports = { makeLimiter, clientIp };
