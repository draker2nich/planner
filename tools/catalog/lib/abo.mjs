/* Источник: Amazon Berkeley Objects (ABO) — открытый набор товаров Amazon с 3D‑моделями.
   https://amazon-berkeley-objects.s3.amazonaws.com/index.html
   Метаданные (≈100 МБ) скачиваются целиком один раз; модели — поштучно и только отобранные (архив на 154 ГБ не нужен).
   В наборе не только мебель: отбор и сопоставление с категориями платформы — в mapping.mjs. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { matchType, chooseForm, colorsOf, materialsOf, stylesOf, cleanName } from './mapping.mjs';
import { readJson, writeJson } from './pack.mjs';

export const ABO_BASE = (process.env.ABO_BASE_URL || 'https://amazon-berkeley-objects.s3.amazonaws.com').replace(/\/+$/, '');
const UA = 'planner-catalog-tools';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Скачивает файл на диск (через .part, с повторами). Возвращает false, если на сервере его нет (404/403). */
export async function download(url, dest, { retries = 4, timeoutMs = 600000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 404 || res.status === 403) { await res.body?.cancel(); return false; }
      if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest + '.part'));
      fs.renameSync(dest + '.part', dest);
      return true;
    } catch (e) {
      fs.rmSync(dest + '.part', { force: true });
      if (attempt >= retries) throw new Error(`Не удалось скачать ${url}: ${e.message}`);
      await sleep(1500 * 2 ** attempt);
    }
  }
}

async function* gzLines(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) if (line) yield line;
}

function csvRow(line) {
  if (!line.includes('"')) return line.split(',');
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}

async function* gzCsv(file) {
  let head = null;
  for await (const line of gzLines(file)) {
    const row = csvRow(line);
    if (!head) { head = row.map((h) => h.trim()); continue; }
    const o = {}; head.forEach((h, i) => { o[h] = row[i]; });
    yield o;
  }
}

/** Имена файлов со списками товаров: сначала спрашиваем у S3, иначе — стандартные listings_0…f. */
async function listingFiles() {
  try {
    const res = await fetch(`${ABO_BASE}/?list-type=2&prefix=listings/metadata/`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
    if (res.ok) {
      const keys = [...(await res.text()).matchAll(/<Key>([^<]+\.json\.gz)<\/Key>/g)].map((m) => m[1]);
      if (keys.length) return keys;
    }
  } catch { /* список закрыт — берём стандартные имена */ }
  return [...'0123456789abcdef'].map((c) => `listings/metadata/listings_${c}.json.gz`);
}

/* значения полей ABO: [{ language_tag, value, standardized_values? }] | строка | нет */
function vals(field) {
  if (field == null) return [];
  const arr = Array.isArray(field) ? field : [field];
  const en = arr.filter((v) => typeof v !== 'object' || !v.language_tag || /^en/i.test(v.language_tag));
  return (en.length ? en : arr).flatMap((v) => (typeof v === 'object' ? [v.value, ...(v.standardized_values || [])] : [v])).filter((v) => v != null && v !== '').map(String);
}
const hasEnglishName = (l) => (Array.isArray(l.item_name) ? l.item_name : []).some((v) => /^en/i.test(v.language_tag || ''));
const listingScore = (l) => (hasEnglishName(l) ? 4 : 0) + (l.domain_name === 'amazon.com' ? 2 : 0) + (l.main_image_id ? 1 : 0);

/**
 * Скачивает метаданные в work/abo-meta и возвращает модели с выбранной для каждой карточкой товара.
 * Результат кэшируется в work/abo-models.json.
 */
export async function loadAbo(work, { log = () => {}, refresh = false } = {}) {
  const cache = path.join(work, 'abo-models.json');
  if (!refresh) { const c = readJson(cache); if (c && c.version === 1) return c.models; }
  const meta = path.join(work, 'abo-meta');
  const get = async (key, required = true) => {
    const dest = path.join(meta, key.replace(/\//g, '__'));
    if (!fs.existsSync(dest)) {
      log('  скачиваю ' + key);
      if (!(await download(`${ABO_BASE}/${key}`, dest)) && required) throw new Error(`В источнике нет файла ${key}. Проверьте адрес ${ABO_BASE} (или переменную ABO_BASE_URL).`);
    }
    return fs.existsSync(dest) ? dest : null;
  };

  const models = new Map();
  for await (const r of gzCsv(await get('3dmodels/metadata/3dmodels.csv.gz'))) {
    const id = r['3dmodel_id']; if (!id || !r.path) continue;
    const ext = [r.extent_x, r.extent_y, r.extent_z].map(Number);
    models.set(id, { modelId: id, modelPath: r.path, faces: Number(r.faces) || null, extent: ext.every((v) => Number.isFinite(v) && v > 0) ? ext : null });
  }
  if (!models.size) throw new Error('Список 3D‑моделей пуст — формат метаданных изменился?');
  log(`  3D‑моделей в наборе: ${models.size}`);

  const best = new Map(); let seen = 0, files = 0;
  for (const key of await listingFiles()) {
    const f = await get(key, false); if (!f) continue; files++;
    for await (const line of gzLines(f)) {
      seen++;
      if (!line.includes('3dmodel_id')) continue;
      let l; try { l = JSON.parse(line); } catch { continue; }
      const mid = l['3dmodel_id']; if (!mid || !models.has(mid)) continue;
      const prev = best.get(mid);
      if (!prev || listingScore(l) > listingScore(prev)) best.set(mid, l);
    }
  }
  if (!files) throw new Error('Не удалось скачать ни одного файла со списком товаров (listings/metadata).');
  log(`  карточек товаров просмотрено: ${seen}, с 3D‑моделью: ${best.size}`);

  const wantImages = new Set([...best.values()].map((l) => l.main_image_id).filter(Boolean));
  const imagePath = new Map();
  const imgFile = await get('images/metadata/images.csv.gz', false);
  if (imgFile) for await (const r of gzCsv(imgFile)) if (wantImages.has(r.image_id)) imagePath.set(r.image_id, r.path);

  const out = [];
  for (const [mid, m] of models) {
    const l = best.get(mid); if (!l) continue;
    out.push({
      ...m, itemId: l.item_id, domain: l.domain_name || '',
      name: vals(l.item_name)[0] || '', brand: vals(l.brand)[0] || '',
      sourceType: vals(l.product_type)[0] || '',
      color: vals(l.color).join(' '), material: [...vals(l.material), ...vals(l.fabric_type), ...vals(l.finish_type)].join(' '), style: vals(l.style).join(' '),
      imagePath: imagePath.get(l.main_image_id) || null,
    });
  }
  writeJson(cache, { version: 1, models: out });
  return out;
}

/** Модель ABO → заготовка товара платформы или причина пропуска. Размеры здесь предварительные (по метаданным), точные — после обработки файла. */
export function planItem(m, { rotateY = 0 } = {}) {
  let sizeMm = m.extent ? { x: m.extent[0] * 1000, y: m.extent[1] * 1000, z: m.extent[2] * 1000 } : null;
  if (sizeMm && rotateY % 180 !== 0) sizeMm = { x: sizeMm.z, y: sizeMm.y, z: sizeMm.x };
  const base = { modelId: m.modelId, name: m.name, sourceType: m.sourceType };
  if (!m.name) return { ...base, skip: 'нет названия' };
  const mt = matchType({ name: m.name, sourceType: m.sourceType, sizeMm });
  if (mt.skip) return { ...base, skip: mt.skip };
  if (sizeMm) { const f = chooseForm(mt.typeId, sizeMm, m.name); if (f.skip) return { ...base, typeId: mt.typeId, skip: f.skip }; }
  // бренд из названия убираем: «Stone & Beam» — не камень
  const bare = m.brand ? m.name.split(m.brand).join(' ') : m.name;
  const text = `${bare} ${m.style}`;
  const colors = colorsOf(m.color); let materials = materialsOf(m.material);
  if (!materials.length) materials = materialsOf(bare);
  return {
    id: 'abo-' + m.modelId, source: 'abo', modelId: m.modelId, typeId: mt.typeId,
    name: cleanName(m.name), fullName: m.name, brand: m.brand.slice(0, 80),
    colors: (colors.length ? colors : colorsOf(bare)).slice(0, 4), materials: materials.slice(0, 4), styleTags: stylesOf(text).slice(0, 4),
    url: m.itemId && m.domain ? `https://www.${m.domain}/dp/${m.itemId}` : '',
    modelUrl: `${ABO_BASE}/3dmodels/original/${m.modelPath}`,
    imageUrl: m.imagePath ? `${ABO_BASE}/images/small/${m.imagePath}` : null,
    faces: m.faces,
  };
}

export function planAll(models, opts) {
  const items = [], skipped = [];
  for (const m of models) { const p = planItem(m, opts); (p.skip ? skipped : items).push(p); }
  return { items, skipped };
}

