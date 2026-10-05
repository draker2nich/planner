/* Чтение и запись GLB, уменьшение текстур, приведение модели к габариту товара.
   Геометрию сжимает gltfpack (см. pack.mjs) — здесь только то, чего он не делает без сборки с libwebp. */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverGlb = require('../../../server/core/glb.js');

const MAGIC = 0x46546c67, CHUNK_JSON = 0x4e4f534a, CHUNK_BIN = 0x004e4942;

export class GlbUnsupported extends Error {}

/** Тот же разбор, что на сервере при загрузке модели: габарит в метрах, число треугольников. */
export const analyze = (buf) => serverGlb.analyze(buf);
export const checkAgainst = (info, expected) => serverGlb.checkAgainst(info, expected);

export function parseGlb(buf) {
  if (buf.length < 20 || buf.readUInt32LE(0) !== MAGIC) throw new GlbUnsupported('не GLB');
  if (buf.readUInt32LE(4) !== 2) throw new GlbUnsupported('нужен glTF 2.0');
  const total = Math.min(buf.readUInt32LE(8), buf.length);
  let off = 12, json = null, bin = null;
  while (off + 8 <= total) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(data.toString('utf8'));
    else if (type === CHUNK_BIN && !bin) bin = data;
    off += 8 + len;
  }
  if (!json) throw new GlbUnsupported('нет JSON‑части');
  return { json, bin: bin || Buffer.alloc(0) };
}

const pad4 = (n) => (4 - (n % 4)) % 4;

export function writeGlb(json, bin) {
  const j = Buffer.from(JSON.stringify(json), 'utf8');
  const jp = pad4(j.length), bp = pad4(bin.length);
  const total = 12 + 8 + j.length + jp + (bin.length ? 8 + bin.length + bp : 0);
  const out = Buffer.alloc(total);
  out.writeUInt32LE(MAGIC, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  out.writeUInt32LE(j.length + jp, 12); out.writeUInt32LE(CHUNK_JSON, 16);
  j.copy(out, 20); out.fill(0x20, 20 + j.length, 20 + j.length + jp);
  if (bin.length) {
    const o = 20 + j.length + jp;
    out.writeUInt32LE(bin.length + bp, o); out.writeUInt32LE(CHUNK_BIN, o + 4);
    bin.copy(out, o + 8);
  }
  return out;
}

/** GLB с одним встроенным буфером — единственный вид, который мы переписываем сами. */
function singleBuffer(json) {
  const b = json.buffers || [];
  return b.length === 1 && !b[0].uri;
}

const addExt = (json, key, name) => { const a = (json[key] ||= []); if (!a.includes(name)) a.push(name); };

/**
 * Уменьшает встроенные текстуры до maxSize по большей стороне и перекодирует в WebP (EXT_texture_webp —
 * загрузчик редактора, three r128, его читает). Возвращает { buf, stats }.
 * Если файл устроен непривычно (внешние буферы, уже сжатые текстуры) — возвращает его без изменений.
 */
export async function shrinkTextures(buf, { maxSize = 1024, quality = 80, sharp }) {
  const { json, bin } = parseGlb(buf);
  const images = json.images || [];
  const stats = { images: images.length, resized: 0, before: 0, after: 0, skipped: null };
  if (!images.length) return { buf, stats };
  if (!singleBuffer(json)) { stats.skipped = 'внешние или несколько буферов'; return { buf, stats }; }
  const views = json.bufferViews || [];

  // какие изображения — карты нормалей (им нужно качество выше)
  const normalImages = new Set();
  for (const m of json.materials || []) {
    const t = m.normalTexture && (json.textures || [])[m.normalTexture.index];
    if (t) { const src = t.extensions?.EXT_texture_webp?.source ?? t.source; if (src != null) normalImages.add(src); }
  }

  const replaced = new Map(); // индекс bufferView → новые байты
  const converted = new Set(); // индексы изображений, ставших WebP
  for (let i = 0; i < images.length; i++) {
    const im = images[i];
    if (im.bufferView == null) continue; // data: или внешний адрес — не трогаем
    const v = views[im.bufferView];
    const src = bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
    stats.before += src.length;
    try {
      const meta = await sharp(src, { limitInputPixels: 268402689 }).metadata();
      if (!meta.width || !meta.height) throw new Error('нет размеров');
      const pipe = sharp(src, { limitInputPixels: 268402689 }).rotate()
        .resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true });
      const out = await pipe.webp({ quality: normalImages.has(i) ? Math.max(quality, 88) : quality, alphaQuality: 90, effort: 4 }).toBuffer();
      if (out.length >= src.length) { stats.after += src.length; continue; } // уже меньше, чем получилось бы
      replaced.set(im.bufferView, out); converted.add(i); stats.resized++; stats.after += out.length;
    } catch { stats.after += src.length; } // формат, который sharp не читает (KTX2 и т. п.), — оставляем
  }
  if (!replaced.size) return { buf, stats };

  for (const i of converted) { images[i].mimeType = 'image/webp'; }
  for (const t of json.textures || []) {
    if (t.source != null && converted.has(t.source)) {
      t.extensions = { ...(t.extensions || {}), EXT_texture_webp: { source: t.source } };
      delete t.source;
    }
  }
  addExt(json, 'extensionsUsed', 'EXT_texture_webp');
  addExt(json, 'extensionsRequired', 'EXT_texture_webp');

  // пересобираем буфер: все bufferView по порядку исходных смещений, изображения — новыми байтами
  const order = views.map((v, i) => i).sort((a, b) => (views[a].byteOffset || 0) - (views[b].byteOffset || 0));
  const chunks = []; let size = 0;
  for (const i of order) {
    const v = views[i];
    const data = replaced.get(i) || bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
    const p = pad4(size); if (p) { chunks.push(Buffer.alloc(p)); size += p; }
    v.byteOffset = size; v.byteLength = data.length;
    chunks.push(data); size += data.length;
  }
  const nbin = Buffer.concat(chunks, size);
  json.buffers[0].byteLength = nbin.length;
  return { buf: writeGlb(json, nbin), stats };
}

/**
 * Оборачивает сцену в два узла: поворот вокруг вертикали (кратный 90°) и масштаб по осям.
 * Так модель после оптимизации точно совпадает с размерами товара (сервер сверяет их с допуском 2 % / 5 мм).
 */
export function wrapTransform(buf, { rotateY = 0, scale = [1, 1, 1] }) {
  const unit = scale.every((s) => Math.abs(s - 1) < 1e-6);
  if (!rotateY && unit) return buf;
  const { json, bin } = parseGlb(buf);
  const scene = (json.scenes || [])[json.scene ?? 0];
  if (!scene) throw new GlbUnsupported('нет сцены');
  json.nodes ||= [];
  const a = (rotateY * Math.PI) / 180;
  const inner = { name: 'catalog-rotate', children: scene.nodes || [], rotation: [0, Math.sin(a / 2), 0, Math.cos(a / 2)] };
  json.nodes.push(inner);
  const outer = { name: 'catalog-fit', children: [json.nodes.length - 1], scale };
  json.nodes.push(outer);
  scene.nodes = [json.nodes.length - 1];
  return writeGlb(json, bin);
}
