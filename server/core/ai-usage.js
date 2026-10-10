'use strict';
/* Сводка расходов ИИ‑дизайнера для админ‑панели. Источник — журнал (audit_log, entity='ai'): на каждое обращение к модели
   там есть шаг, модель, число токенов ввода и вывода, сколько из ввода прочитано из кэша (cr) и записано в него (cw), ошибка.

   Визуализация комнаты (шаг render, server/core/renders.js) пишет в тот же журнал: в сводке она отдельной строкой со своей моделью.

   Стоимость считается, только если заданы цены (за миллион токенов, в любой валюте):
     AI_PRICE_IN, AI_PRICE_OUT   цена ввода и вывода для всех моделей
     AI_PRICES                   JSON по моделям: {"claude-opus-5-5":{"in":5,"out":25},"*":{"in":1,"out":5}}
                                 у записи можно задать множители кэша cacheRead (по умолчанию 0.1) и cacheWrite (1.25)
     AI_PRICE_CURRENCY           обозначение валюты в сводке, по умолчанию USD
   Цены в код не зашиты намеренно: они меняются и зависят от провайдера. Без цен сводка показывает только токены. */

const DAY = 864e5;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const price = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };

function readPrices(env = {}) {
  const table = {};
  const put = (model, o) => {
    if (!o || typeof o !== 'object') return;
    const pin = price(o.in), pout = price(o.out);
    if (pin == null || pout == null) return;
    const cr = price(o.cacheRead), cw = price(o.cacheWrite);
    table[model] = { in: pin, out: pout, cacheRead: cr == null ? 0.1 : cr, cacheWrite: cw == null ? 1.25 : cw };
  };
  if (env.AI_PRICE_IN != null && env.AI_PRICE_IN !== '' && env.AI_PRICE_OUT != null && env.AI_PRICE_OUT !== '') put('*', { in: env.AI_PRICE_IN, out: env.AI_PRICE_OUT });
  try { const j = JSON.parse(String(env.AI_PRICES || '') || '{}'); if (j && typeof j === 'object' && !Array.isArray(j)) for (const [m, o] of Object.entries(j)) put(m, o); } catch { /* некорректный JSON — как будто цен нет */ }
  const currency = String(env.AI_PRICE_CURRENCY || 'USD').trim().slice(0, 8) || 'USD';
  return { table, currency, any: Object.keys(table).length > 0, of: (model) => table[model] || table['*'] || null };
}

/* Стоимость одной группы обращений; null — цена модели неизвестна */
function costOf(p, r) {
  if (!p) return null;
  const fresh = Math.max(0, r.in - r.cacheRead - r.cacheWrite);
  return ((fresh + r.cacheRead * p.cacheRead + r.cacheWrite * p.cacheWrite) * p.in + r.out * p.out) / 1e6;
}

function makeAiUsage(db, env = {}) {
  /* поле JSON из колонки data: у SQLite и Postgres свой синтаксис */
  const pg = db.dialect === 'postgres';
  const jn = (k) => (pg ? `COALESCE(CAST(data::json->>'${k}' AS DOUBLE PRECISION), 0)` : `COALESCE(CAST(json_extract(data, '$.${k}') AS REAL), 0)`);
  const jt = (k) => (pg ? `data::json->>'${k}'` : `json_extract(data, '$.${k}')`);
  const SUMS = `CAST(COUNT(*) AS INTEGER) AS calls, SUM(CASE WHEN ${jt('error')} IS NOT NULL THEN 1 ELSE 0 END) AS errors,
    SUM(${jn('in')}) AS tin, SUM(${jn('out')}) AS tout, SUM(${jn('cr')}) AS cr, SUM(${jn('cw')}) AS cw, SUM(${jn('ms')}) AS ms`;

  return {
    prices: () => readPrices(env),
    /* days — глубина сводки в сутках (1…90) */
    async summary(days = 30) {
      const n = Math.max(1, Math.min(90, Math.floor(Number(days)) || 30));
      const since = new Date(Date.now() - n * DAY).toISOString();
      const prices = readPrices(env);
      const rows = await db.all(`SELECT substr(at, 1, 10) AS day, action, COALESCE(${jt('model')}, '') AS model, ${SUMS}
        FROM audit_log WHERE entity = 'ai' AND at >= ? GROUP BY substr(at, 1, 10), action, COALESCE(${jt('model')}, '')`, [since]);
      const blank = () => ({ calls: 0, errors: 0, in: 0, out: 0, cacheRead: 0, cacheWrite: 0, ms: 0, cost: prices.any ? 0 : null, unpriced: 0 });
      const add = (t, r) => {
        t.calls += r.calls; t.errors += r.errors; t.in += r.in; t.out += r.out; t.cacheRead += r.cacheRead; t.cacheWrite += r.cacheWrite; t.ms += r.ms;
        if (r.cost == null) { if (r.in || r.out) t.unpriced += r.calls - r.errors; } else if (t.cost != null) t.cost += r.cost;
      };
      const total = blank(), byDay = new Map(), bySM = new Map();
      let runs = 0, renders = 0, runCost = prices.any ? 0 : null; // runCost — расход самого ИИ‑дизайнера, без визуализаций
      for (const x of rows) {
        const r = { calls: num(x.calls), errors: num(x.errors), in: num(x.tin), out: num(x.tout), cacheRead: num(x.cr), cacheWrite: num(x.cw), ms: num(x.ms) };
        const model = String(x.model || '');
        r.cost = model === 'mock' ? 0 : costOf(prices.of(model), r);
        const step = String(x.action || '').replace(/^ai\./, '');
        if (step === 'concept') runs += r.calls - r.errors; // генерация = удачная «концепция»
        if (step === 'render') renders += r.calls - r.errors; // визуализация комнаты — отдельная модель и отдельная цена
        else if (runCost != null && r.cost != null) runCost += r.cost;
        add(total, r);
        if (!byDay.has(x.day)) byDay.set(x.day, { day: x.day, ...blank() }); add(byDay.get(x.day), r);
        const k = step + '|' + model; if (!bySM.has(k)) bySM.set(k, { step, model, ...blank() }); add(bySM.get(k), r);
      }
      const users = await db.all(`SELECT a.user_id AS id, u.email AS email, ${SUMS.replace(/data/g, 'a.data')}
        FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.entity = 'ai' AND a.at >= ? AND a.user_id IS NOT NULL
        GROUP BY a.user_id, u.email ORDER BY SUM(${jn('in').replace(/data/g, 'a.data')}) + SUM(${jn('out').replace(/data/g, 'a.data')}) DESC LIMIT 10`, [since]);
      const order = { taste: 0, concept: 1, layout: 2, render: 3 };
      return {
        days: n, since, currency: prices.currency, priced: prices.any, runs, renders, runCost, total,
        byDay: [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)),
        bySteps: [...bySM.values()].sort((a, b) => (order[a.step] ?? 9) - (order[b.step] ?? 9) || (a.model < b.model ? -1 : 1)),
        topUsers: users.map((u) => ({ id: u.id, email: u.email || null, calls: num(u.calls), errors: num(u.errors), in: num(u.tin), out: num(u.tout) })),
      };
    },
  };
}

module.exports = { makeAiUsage, readPrices, costOf };
