'use strict';
/* Набор каталога, который лежит в самом проекте: public/catalog-pack (его собирает tools/catalog).
   При запуске сервера товары набора записываются в базу — отдельный шаг импорта не нужен: достаточно выложить папку
   вместе с проектом. Файлы моделей и фото раздаются как обычная статика сайта, хранилище платформы не расходуется.
   Сверка идёт по отметке manifest.json: пока набор не менялся, запуск стоит одного запроса к базе. */
const fs = require('node:fs');
const path = require('node:path');

const BASE = '/catalog-pack';
const SAFE_FILE = /^(models|images)\/[A-Za-z0-9._-]+$/;
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const valid = (m) => (m && m.version === 1 && Array.isArray(m.items) ? m : null);

/* Путь записан целиком, от __dirname: так сборщик Vercel видит файл и кладёт его в функцию (плюс includeFiles в vercel.json).
   Если в функцию файл всё же не попал, на Vercel он берётся как статика этого же деплоя. */
async function readManifest(env = {}) {
  let text;
  try { text = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'catalog-pack', 'manifest.json'), 'utf8'); }
  catch (e) {
    if (e.code !== 'ENOENT' || !env.VERCEL || !env.VERCEL_URL) return null;
    try {
      const r = await fetch(`https://${env.VERCEL_URL}${BASE}/manifest.json`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return null;
      text = await r.text();
    } catch { return null; }
  }
  try { return valid(JSON.parse(text)); } catch { return null; }
}

function toImportItem(it) {
  if (!it || !it.model || !SAFE_FILE.test(String(it.model.file || '')) || !it.model.info) return null;
  const img = it.image && SAFE_FILE.test(String(it.image.file || '')) ? it.image : null;
  return {
    id: it.id, typeId: it.typeId, formId: it.formId, name: it.name, brand: it.brand, price: it.price, currency: it.currency,
    dims: it.dims, colors: it.colors, materials: it.materials, styleTags: it.styleTags, url: it.url,
    model: { url: `${BASE}/${it.model.file}`, info: { ...it.model.info, bytes: it.model.bytes } },
    images: img ? [{ url: `${BASE}/${img.file}`, mime: img.mime || MIME[path.extname(img.file).toLowerCase()] }] : [],
  };
}

/* → null, если набора нет или он уже записан; иначе { imported, published, removed, errors }.
   force — записать заново, даже если отметка совпадает (после «Удалить демо»). */
async function syncPack(ctx, { force = false } = {}) {
  const m = await readManifest(ctx.env);
  if (!m) return null;
  const { db } = ctx;
  const mark = `${m.generatedAt || ''}|${m.items.length}`;
  if (!force) {
    const row = await db.get("SELECT value FROM settings WHERE key='catalog_pack'");
    if (row && row.value === mark) return null;
  }
  const items = m.items.map(toImportItem).filter(Boolean);
  const res = await ctx.catalog.importBatch(items, { batch: 100 });

  // товары прежней версии набора, которых в новой уже нет
  const keep = new Set(items.map((i) => i.id));
  const gone = (await db.all(`SELECT id FROM products WHERE source='demo' AND model_file LIKE '${BASE}/%'`)).map((r) => r.id).filter((id) => !keep.has(id));
  for (let i = 0; i < gone.length; i += 200) {
    const part = gone.slice(i, i + 200), marks = part.map(() => '?').join(',');
    await db.run(`DELETE FROM product_images WHERE product_id IN (${marks})`, part);
    await db.run(`DELETE FROM products WHERE source='demo' AND id IN (${marks})`, part);
  }
  await db.run("INSERT INTO settings (key, value) VALUES ('catalog_pack', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [mark]);
  const out = { imported: res.imported, published: res.published, removed: gone.length, errors: res.errors.length };
  console.log(`Набор каталога из проекта записан в базу: товаров ${out.imported}, опубликовано ${out.published}, убрано устаревших ${out.removed}, с ошибками ${out.errors}.`);
  for (const e of res.errors.slice(0, 5)) console.warn(`  набор: ${e.id}: ${e.message}`);
  return out;
}

module.exports = { syncPack, readManifest };
