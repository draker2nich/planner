'use strict';
/* Слой базы данных. Один асинхронный интерфейс для двух драйверов:
   - sqlite   — локально, встроенный node:sqlite (Node 22.5+), файл data/planner.sqlite;
   - postgres — на Vercel, Neon по HTTP (@neondatabase/serverless), строка подключения DATABASE_URL.
   Интерфейс: get(sql, params) → строка | undefined; all(sql, params) → строки; run(sql, params) → { changes }.
   В SQL используются плейсхолдеры «?» — для Postgres они переводятся в $1, $2… */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    info TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','blocked')),
    created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','company','client')),
    company_id TEXT REFERENCES companies(id),
    name TEXT NOT NULL DEFAULT '',
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    owner_company_id TEXT REFERENCES companies(id),
    source TEXT NOT NULL DEFAULT 'admin' CHECK (source IN ('admin','company','demo')),
    type_id TEXT NOT NULL,
    form_id TEXT NOT NULL,
    name TEXT NOT NULL,
    brand TEXT NOT NULL DEFAULT '',
    price DOUBLE PRECISION NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    dims TEXT NOT NULL DEFAULT '{}',
    colors TEXT NOT NULL DEFAULT '[]',
    materials TEXT NOT NULL DEFAULT '[]',
    style_tags TEXT NOT NULL DEFAULT '[]',
    url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','published','rejected','archived')),
    reject_reason TEXT NOT NULL DEFAULT '',
    model_status TEXT NOT NULL DEFAULT 'none' CHECK (model_status IN ('none','ready','mismatch','generating','failed')),
    model_source TEXT CHECK (model_source IS NULL OR model_source IN ('upload','ai')),
    model_file TEXT,
    model_info TEXT NOT NULL DEFAULT '{}',
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS products_type ON products(type_id, form_id)`,
  `CREATE INDEX IF NOT EXISTS products_status ON products(status)`,
  `CREATE INDEX IF NOT EXISTS products_owner ON products(owner_company_id)`,
  `CREATE TABLE IF NOT EXISTS product_images (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    file TEXT NOT NULL,
    mime TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS model_jobs (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','canceled')),
    input TEXT NOT NULL DEFAULT '{}',
    result TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id {{AUTO_ID}},
    user_id TEXT,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    at TEXT NOT NULL)`,
];
/* Последующие миграции: по одному массиву выражений на версию (версия = индекс + 2) */
const MIGRATIONS = [
  // v2: поле для поиска без учёта регистра (SQLite не понижает регистр кириллицы в LOWER/LIKE)
  ["ALTER TABLE products ADD COLUMN search TEXT NOT NULL DEFAULT ''"],
];
const SCHEMA_VERSION = 1 + MIGRATIONS.length;

/* «?» → $1, $2… (строковые литералы в кавычках не трогаются) */
function toPg(sql) {
  let n = 0, out = '', q = false;
  for (const ch of sql) {
    if (ch === "'") q = !q;
    out += (!q && ch === '?') ? '$' + (++n) : ch;
  }
  return out;
}

function sqliteDriver(file) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const norm = (p) => (p || []).map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
  return {
    dialect: 'sqlite',
    autoId: 'INTEGER PRIMARY KEY AUTOINCREMENT',
    async get(sql, p) { return db.prepare(sql).get(...norm(p)); },
    async all(sql, p) { return db.prepare(sql).all(...norm(p)); },
    async run(sql, p) { const r = db.prepare(sql).run(...norm(p)); return { changes: Number(r.changes) }; },
    close() { db.close(); },
  };
}

/* neon — функция из @neondatabase/serverless (передаётся снаружи, чтобы драйвер можно было подменить в тестах) */
function postgresDriver(neon, url) {
  const sql = neon(url, { fullResults: true });
  const q = (text, p) => sql.query(toPg(text), (p || []).map(v => v === undefined ? null : v), { fullResults: true });
  return {
    dialect: 'postgres',
    autoId: 'BIGSERIAL PRIMARY KEY',
    async get(text, p) { const r = await q(text, p); return r.rows[0]; },
    async all(text, p) { const r = await q(text, p); return r.rows; },
    async run(text, p) { const r = await q(text, p); return { changes: r.rowCount ?? 0 }; },
    close() {},
  };
}

async function migrate(db) {
  await db.run('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  const row = await db.get('SELECT MAX(v) AS v FROM schema_version');
  const v = row && row.v != null ? Number(row.v) : 0;
  if (v >= SCHEMA_VERSION) return;
  if (v < 1) { for (const st of SCHEMA) await db.run(st.replace('{{AUTO_ID}}', db.autoId)); await db.run('INSERT INTO schema_version (v) VALUES (1)'); }
  for (let i = Math.max(v, 1) + 1; i <= SCHEMA_VERSION; i++) {
    for (const st of MIGRATIONS[i - 2]) {
      try { await db.run(st); } catch (e) { if (!/duplicate column|already exists/i.test(e.message)) throw e; } // параллельный холодный старт
    }
    await db.run('INSERT INTO schema_version (v) VALUES (?)', [i]);
  }
}

module.exports = { sqliteDriver, postgresDriver, migrate, toPg };
