/* Запись набора в базу проекта напрямую, через то же ядро каталога, что и сервер (server/core/catalog.js).
   Функция Vercel не участвует — её ограничения на размер запроса и время не действуют.
   База выбирается по окружению: DATABASE_URL → Neon (Vercel), иначе локальный SQLite в data/. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { analyze } from './glb.mjs';
import { readJson, mb } from './pack.mjs';

const require = createRequire(import.meta.url);

const FUNCTION_RESPONSE_LIMIT = 4.5 * 1048576; // предел ответа функции Vercel; каталог редактор получает одним ответом

export async function importPack({ root, pack, baseUrl, upload, publish, dryRun, dropGenerated, log }) {
  const manifest = readJson(path.join(pack, 'manifest.json'));
  if (!manifest || !Array.isArray(manifest.items)) throw new Error(`В ${pack} нет manifest.json — сначала соберите набор (abo-build или local-build).`);
  if (!!baseUrl === !!upload) throw new Error('Укажите одно из двух: --base-url <адрес, где опубликованы файлы набора> или --upload (копировать в хранилище локального сервера).');
  if (baseUrl && !/^(https:\/\/|\/)[^\s]*$/.test(baseUrl)) throw new Error('--base-url должен быть адресом https://… или путём от корня сайта (/catalog-pack).');
  const base = baseUrl ? baseUrl.replace(/\/+$/, '') : null;

  const { fromEnv } = require(path.join(root, 'server/core/app.js'));
  const { migrate } = require(path.join(root, 'server/core/db.js'));
  const { makeCatalog } = require(path.join(root, 'server/core/catalog.js'));
  const env = { ...process.env }; delete env.VERCEL; // запуск с машины разработчика, даже если переменные взяты из vercel env pull
  let ctx;
  try { ctx = await fromEnv(env, { dataDir: path.resolve(env.DATA_DIR || path.join(root, 'data')) }); }
  catch (e) { throw new Error(/Cannot find (package|module)/.test(e.message) ? 'Для работы с Neon и Vercel Blob выполните npm install в корне проекта. ' + e.message : e.message); }
  const { db, storage } = ctx;
  const where = db.dialect === 'postgres' ? 'Postgres (Neon) по DATABASE_URL — это база сайта на Vercel' : 'локальный SQLite в ' + path.join(env.DATA_DIR || path.join(root, 'data'), 'planner.sqlite');
  log(`База: ${where}`);
  if (upload && storage.kind !== 'fs') throw new Error('--upload работает только с локальным хранилищем (data/uploads). Для сайта на Vercel опубликуйте файлы набора отдельно и передайте --base-url: загрузка тысяч файлов в Vercel Blob исчерпает бесплатный лимит операций, и хранилище отключится на 30 дней.');

  const name = path.basename(pack).replace(/[^A-Za-z0-9._-]+/g, '-') || 'pack';
  const items = []; let missing = 0, bytes = 0;
  for (const it of manifest.items) {
    const file = path.join(pack, it.model.file);
    if (!fs.existsSync(file)) { missing++; continue; }
    const buf = fs.readFileSync(file);
    let info; try { info = analyze(buf); } catch (e) { log(`  пропуск ${it.id}: ${e.message}`); missing++; continue; }
    bytes += buf.length;
    const img = it.image && fs.existsSync(path.join(pack, it.image.file)) ? it.image : null;
    let modelUrl, imageUrl = null;
    if (upload) {
      if (!dryRun) {
        modelUrl = await storage.put(`catalog/${name}/${it.model.file}`, buf, 'model/gltf-binary');
        if (img) imageUrl = await storage.put(`catalog/${name}/${img.file}`, fs.readFileSync(path.join(pack, img.file)), img.mime);
      } else { modelUrl = `/files/catalog/${name}/${it.model.file}`; imageUrl = img && `/files/catalog/${name}/${img.file}`; }
    } else { modelUrl = `${base}/${it.model.file}`; imageUrl = img && `${base}/${img.file}`; }
    items.push({
      id: it.id, typeId: it.typeId, formId: it.formId, name: it.name, brand: it.brand, price: it.price, currency: it.currency,
      dims: it.dims, colors: it.colors, materials: it.materials, styleTags: it.styleTags, url: it.url,
      model: { url: modelUrl, info: { ...info, bytes: buf.length } }, images: imageUrl ? [{ url: imageUrl, mime: img.mime }] : [],
    });
  }
  log(`Набор: ${items.length} товаров, модели ${mb(bytes)}${missing ? `, без файла модели пропущено: ${missing}` : ''}`);
  if (!items.length) throw new Error('В наборе нет ни одного товара с файлом модели.');

  if (dryRun) { log('Пробный запуск (--dry-run): в базу ничего не записано.'); db.close?.(); return; }
  await migrate(db);
  const catalog = makeCatalog(db, storage);
  const res = await catalog.importBatch(items, { publish });
  log(`Записано: ${res.imported} (опубликовано ${res.published}, черновиков ${res.drafts}).`);
  if (res.errors.length) {
    log(`Не прошли проверку: ${res.errors.length}`);
    for (const e of res.errors.slice(0, 15)) log(`  ${e.id}: ${e.message}${e.details ? ' ' + JSON.stringify(e.details) : ''}`);
  }
  if (dropGenerated) {
    // сгенерированные «коробки» без моделей и атрибутов (seedDemo, id вида p-<тип>-<форма>-<S|M|L>) — чтобы не мешались с настоящими
    await db.run("DELETE FROM product_images WHERE product_id IN (SELECT id FROM products WHERE source='demo' AND id LIKE 'p-%')");
    const d = await db.run("DELETE FROM products WHERE source='demo' AND id LIKE 'p-%'");
    log(`Удалено сгенерированных демо‑товаров без моделей: ${d.changes}`);
  }
  // редактор читает каталог порциями по 2000 товаров — проверяем, что самая большая порция проходит в предел
  let worst = 0, published = 0;
  for (let off = 0; off != null;) { const pg = await catalog.publicPage({ limit: 2000, offset: off }); worst = Math.max(worst, Buffer.byteLength(JSON.stringify(pg))); published = pg.total; off = pg.next; }
  log(`Опубликовано в каталоге: ${published}. Порция каталога для редактора — до ${worst < 1048576 ? Math.ceil(worst / 1024) + ' КБ' : (worst / 1048576).toFixed(2) + ' МБ'} (предел ответа функции Vercel — 4,5 МБ).`);
  if (worst > FUNCTION_RESPONSE_LIMIT * 0.8) log('  ВНИМАНИЕ: порция близка к пределу. Сократите адреса файлов (--base-url) или размер порции в редакторе.');
  if (base && base.startsWith('https://')) log(`Проверьте, что ${base} отдаёт заголовок Access-Control-Allow-Origin: редактор загружает модели запросом с другого домена.`);
  db.close?.();
  return res;
}
