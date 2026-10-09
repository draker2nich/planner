#!/usr/bin/env node
/* Наполнение каталога без админ‑панели: набор товаров собирается на своей машине и заливается прямо в базу.
   Подробности и порядок действий — tools/catalog/README.md. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { processModel, packPaths, readJson, writeJson, writeManifest, mb, pool } from './lib/pack.mjs';
import { loadAbo, planAll, download } from './lib/abo.mjs';
import { T, matchType, colorsOf, materialsOf, stylesOf, cleanName, syntheticPrice } from './lib/mapping.mjs';
import { importPack } from './lib/import.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const log = (...a) => console.log(...a);

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const [k, inline] = a.slice(2).split(/=(.*)/s);
    const next = argv[i + 1];
    if (inline !== undefined) o[k] = inline;
    else if (next !== undefined && !next.startsWith('--')) { o[k] = next; i++; }
    else o[k] = true;
  }
  return o;
}
const num = (v, d) => (v === undefined || v === true ? d : Number(v));
const list = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : null);
const dirArg = (v, d) => path.resolve(typeof v === 'string' ? v : path.join(ROOT, d));

function checkTypes(types) {
  for (const t of types || []) if (!T.TYPE.has(t)) throw new Error(`Нет категории «${t}». Список — в public/shared/catalog-types.js`);
}

/* Отбор: фильтр по категориям, не больше perType на категорию, затем «по кругу» между категориями —
   прерванный или ограниченный запуск всё равно даёт сбалансированный набор. */
function select(items, { types, perType, limit }) {
  const by = new Map();
  for (const it of items) {
    if (types && !types.includes(it.typeId)) continue;
    if (!by.has(it.typeId)) by.set(it.typeId, []);
    const a = by.get(it.typeId); if (!perType || a.length < perType) a.push(it);
  }
  const out = []; const groups = [...by.values()];
  for (let i = 0; groups.some((g) => i < g.length); i++) for (const g of groups) if (i < g.length) out.push(g[i]);
  return limit ? out.slice(0, limit) : out;
}

function summary(title, map, top = 60) {
  log(title);
  for (const [k, v] of [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)) log(`  ${String(v).padStart(6)}  ${k}`);
}
const count = (arr, key) => { const m = new Map(); for (const x of arr) { const k = key(x); m.set(k, (m.get(k) || 0) + 1); } return m; };
const typeName = (id) => `${T.TYPE.get(id)?.name || id} (${id})`;

/* ---------- abo-plan ---------- */
async function aboPlan(o) {
  const work = dirArg(o.work, 'catalog-work'); fs.mkdirSync(work, { recursive: true });
  log('Метаданные ABO → ' + work);
  const models = await loadAbo(work, { log, refresh: !!o.refresh });
  const { items, skipped } = planAll(models, { rotateY: num(o['rotate-y'], 0) });
  writeJson(path.join(work, 'abo-plan.json'), { items, skipped });
  fs.writeFileSync(path.join(work, 'abo-skipped.csv'), 'model_id,source_type,reason,name\n' + skipped.map((s) => [s.modelId, s.sourceType, s.skip, '"' + String(s.name).replace(/"/g, '""') + '"'].join(',')).join('\n'));
  log(`\nМоделей с карточкой товара: ${models.length}. Подходит для каталога: ${items.length}, пропущено: ${skipped.length}`);
  summary('\nПо категориям платформы:', count(items, (i) => typeName(i.typeId)));
  summary('\nПричины пропуска:', count(skipped, (s) => s.skip.replace(/: .*/, '')), 15);
  summary('\nПропущено по типам источника (кандидаты на новые правила в lib/mapping.mjs):', count(skipped.filter((s) => s.skip === 'тип не распознан'), (s) => s.sourceType || '—'), 15);
  log(`\nПолный список пропущенных: ${path.join(work, 'abo-skipped.csv')}`);
  log('Дальше: node tools/catalog/cli.mjs abo-build --limit 20   (проба), затем без --limit.');
  return { items, skipped };
}

/* ---------- сборка набора ---------- */
function buildOptions(o) {
  return { maxTexture: num(o.tex, 1024), maxTris: num(o.tris, 30000), rotateY: num(o['rotate-y'], 0), quality: num(o.quality, 80) };
}

async function buildItems(todo, p, o, fetchSource) {
  const opts = buildOptions(o), maxBytes = num(o['max-mb'], 0) * 1048576, jobs = num(o.jobs, Math.max(1, Math.min(4, os.cpus().length - 1)));
  let total = 0, done = 0, okN = 0, failN = 0, skipN = 0, stop = false;
  for (const f of fs.readdirSync(p.items)) { const it = readJson(path.join(p.items, f)); if (it?.model) total += it.model.bytes + (it.image?.bytes || 0); }
  const t0 = Date.now();
  await pool(todo, jobs, async (plan) => {
    const tag = () => `[${++done}/${todo.length}]`;
    const itemFile = path.join(p.items, plan.id + '.json'), failFile = path.join(p.failed, plan.id + '.json');
    if (fs.existsSync(itemFile) || (fs.existsSync(failFile) && !o['retry-failed'])) { skipN++; done++; return; }
    if (stop) { done++; return; }
    try {
      const src = await fetchSource(plan);
      const r = await processModel(src.model, { typeId: plan.typeId, name: plan.fullName || plan.name, ...opts });
      if (!r.ok) { writeJson(failFile, { id: plan.id, name: plan.name, typeId: plan.typeId, reason: r.reason }); failN++; log(`${tag()} —   ${plan.id}  ${r.reason}`); return; }
      const item = {
        id: plan.id, source: plan.source, typeId: plan.typeId, formId: r.formId, name: plan.name, brand: plan.brand || '',
        price: plan.price ?? syntheticPrice({ id: plan.id, typeId: plan.typeId, formId: r.formId, dims: r.dims, brand: plan.brand }), currency: plan.currency || T.PLATFORM_CURRENCY,
        dims: r.dims, colors: plan.colors || [], materials: plan.materials || [], styleTags: plan.styleTags || [], url: plan.url || '',
        model: { file: `models/${plan.id}.glb`, bytes: r.buf.length, info: r.info }, stats: r.stats,
      };
      fs.writeFileSync(path.join(p.dir, item.model.file), r.buf);
      if (src.image) { item.image = { file: `images/${plan.id}.${src.image.ext}`, bytes: src.image.buf.length, mime: src.image.mime }; fs.writeFileSync(path.join(p.dir, item.image.file), src.image.buf); }
      writeJson(itemFile, item); fs.rmSync(failFile, { force: true });
      total += item.model.bytes + (item.image?.bytes || 0); okN++;
      log(`${tag()} ок  ${plan.id}  ${plan.typeId}/${r.formId}  ${mb(r.stats.srcBytes)} → ${mb(r.stats.bytes)}  | набор ${mb(total)}`);
      if (maxBytes && total >= maxBytes && !stop) { stop = true; log(`Достигнут предел --max-mb ${o['max-mb']}: остальные модели не обрабатываются.`); }
    } catch (e) {
      // сетевая ошибка или сбой инструмента — не помечаем как негодную, следующий запуск попробует снова
      failN++; log(`${tag()} !!  ${plan.id}  ${e.message}`);
      if (/Не найден (gltfpack|пакет sharp)/.test(e.message)) { stop = true; throw e; }
    }
  });
  const m = writeManifest(p, { source: todo[0]?.source || 'local', options: opts });
  log(`\nГотово за ${Math.round((Date.now() - t0) / 1000)} с: новых ${okN}, не подошло или ошибка ${failN}, уже было ${skipN}.`);
  log(`В наборе ${m.count} товаров, ${mb(m.bytes)} → ${p.dir}`);
  summary('По категориям:', new Map(Object.entries(m.byType).map(([k, v]) => [typeName(k), v])));
  hostingHint(m, p);
}

function hostingHint(m, p) {
  log('\nГде разместить файлы набора (папки models/ и images/):');
  if (m.bytes < 300 * 1048576) log('  • набор небольшой — можно положить в public/ проекта (тогда: import --base-url /<папка>), хранилище Vercel Blob не тратится;');
  else log('  • набор крупный — в репозиторий проекта его класть не стоит;');
  log('  • любой статический хостинг с CORS (например Cloudflare R2): import --base-url https://…;');
  log('  • локальный сервер после переезда: import --upload (файлы копируются в data/uploads).');
  log(`Затем: node tools/catalog/cli.mjs import --pack ${path.relative(process.cwd(), p.dir) || '.'} --base-url <адрес>`);
}

async function aboBuild(o) {
  const work = dirArg(o.work, 'catalog-work'), p = packPaths(dirArg(o.pack, 'catalog-pack'));
  const types = list(o.types); checkTypes(types);
  let plan = readJson(path.join(work, 'abo-plan.json'));
  if (!plan || o.refresh) plan = await aboPlan(o);
  const todo = select(plan.items, { types, perType: num(o['per-type'], 0), limit: num(o.limit, 0) });
  if (!todo.length) throw new Error('Нечего обрабатывать: проверьте --types');
  log(`\nК обработке: ${todo.length} моделей (из ${plan.items.length} подходящих). Исходные файлы скачиваются по одному и после обработки удаляются.`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-abo-'));
  try {
    await buildItems(todo, p, o, async (it) => {
      const f = path.join(tmp, it.modelId + '.glb');
      try {
        if (!(await download(it.modelUrl, f))) throw new Error('модели нет в источнике: ' + it.modelUrl);
        const out = { model: fs.readFileSync(f) };
        if (it.imageUrl) {
          const g = path.join(tmp, it.modelId + '.img');
          try { if (await download(it.imageUrl, g, { retries: 2 })) out.image = { buf: fs.readFileSync(g), ext: 'jpg', mime: 'image/jpeg' }; } catch { /* товар останется без фото */ } finally { fs.rmSync(g, { force: true }); }
        }
        return out;
      } finally { fs.rmSync(f, { force: true }); }
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/* Свои модели из папки: *.glb и необязательный items.json
   [{ "file": "sofa.glb", "typeId": "sofa", "name": "…", "brand": "…", "price": 1690, "currency": "BYN", "colors": […], "materials": […], "styleTags": […], "image": "sofa.jpg" }] */
async function localBuild(o) {
  if (typeof o.in !== 'string') throw new Error('Укажите папку с моделями: --in <папка>');
  const dir = path.resolve(o.in), p = packPaths(dirArg(o.pack, 'catalog-pack'));
  const described = readJson(path.join(dir, 'items.json'), null);
  const files = described ? described : fs.readdirSync(dir).filter((f) => /\.glb$/i.test(f)).sort().map((file) => ({ file }));
  const IMG = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  const todo = [];
  for (const d of files) {
    const base = path.basename(d.file, path.extname(d.file));
    const name = d.name || base.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
    let typeId = d.typeId;
    if (!typeId) { const m = matchType({ name }); if (m.skip) { log(`—   ${d.file}: ${m.skip} (задайте typeId в items.json)`); continue; } typeId = m.typeId; }
    checkTypes([typeId]);
    todo.push({ id: d.id || 'local-' + base.toLowerCase().replace(/[^a-z0-9._-]+/g, '-'), source: 'local', typeId, name: cleanName(name), fullName: name, brand: d.brand || '', price: d.price, currency: d.currency,
      colors: d.colors || colorsOf(name), materials: d.materials || materialsOf(name), styleTags: d.styleTags || stylesOf(name), url: d.url || '', file: d.file, image: d.image });
  }
  if (!todo.length) throw new Error('В папке нет подходящих моделей .glb');
  await buildItems(select(todo, { types: list(o.types), limit: num(o.limit, 0) }), p, o, async (it) => {
    const out = { model: fs.readFileSync(path.join(dir, it.file)) };
    const img = it.image && path.join(dir, it.image);
    if (img && fs.existsSync(img) && IMG[path.extname(img).toLowerCase()]) out.image = { buf: fs.readFileSync(img), ext: path.extname(img).slice(1).toLowerCase(), mime: IMG[path.extname(img).toLowerCase()] };
    return out;
  });
}

const HELP = `Наполнение каталога набором товаров с 3D‑моделями.

  node tools/catalog/cli.mjs <команда> [параметры]

Команды:
  abo-plan      скачать метаданные Amazon Berkeley Objects, отобрать мебель и показать, сколько моделей подойдёт
  abo-build     скачать отобранные модели по одной, сжать и сложить в набор
  local-build   то же для своих моделей: --in <папка с .glb>
  manifest      пересобрать manifest.json набора
  import        записать набор в базу проекта (локальную или Neon — по переменным окружения)

Общие параметры:
  --pack <папка>     набор (по умолчанию catalog-pack)          --work <папка>  кэш метаданных (catalog-work)
Сборка (abo-build, local-build):
  --limit N          не больше N моделей                        --per-type N    не больше N на категорию
  --types a,b        только эти категории (id из catalog-types) --max-mb N      остановиться, когда набор достигнет N МБ
  --tex 1024         предел размера текстур, пикс.              --tris 30000    предел числа треугольников
  --rotate-y 0       повернуть все модели вокруг вертикали (90/180/270), если «перед» смотрит не туда
  --jobs N           сколько моделей обрабатывать одновременно  --retry-failed  заново попробовать отклонённые
Импорт:
  --base-url <адрес> где опубликованы файлы набора (https://… или путь от корня сайта, например /catalog-pack)
  --upload           вместо этого скопировать файлы в хранилище платформы (только локальный сервер, data/uploads)
  --draft            не публиковать, оставить черновиками       --dry-run       только проверить, в базу не писать
  --drop-generated   заодно удалить прежние сгенерированные демо‑товары без моделей («Диван Nord S» и т. п.)
`;

const commands = {
  'abo-plan': aboPlan, 'abo-build': aboBuild, 'local-build': localBuild,
  manifest: async (o) => { const p = packPaths(dirArg(o.pack, 'catalog-pack')); const m = writeManifest(p, readJson(p.manifest) ? { source: readJson(p.manifest).source, options: readJson(p.manifest).options } : {}); log(`manifest.json: ${m.count} товаров, ${mb(m.bytes)}`); },
  import: (o) => importPack({ root: ROOT, pack: dirArg(o.pack, 'catalog-pack'), baseUrl: typeof o['base-url'] === 'string' ? o['base-url'] : null, upload: !!o.upload, publish: !o.draft, dryRun: !!o['dry-run'], dropGenerated: !!o['drop-generated'], log }),
};

const o = parseArgs(process.argv.slice(2));
const cmd = commands[o._[0]];
if (!cmd || o.help) { console.log(HELP); process.exit(cmd || !o._[0] ? 0 : 1); }
cmd(o).catch((e) => { console.error('\nОшибка: ' + e.message); process.exit(1); });
