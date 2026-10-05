/* Обработка одной модели: габарит → форма и размеры товара → уменьшение текстур → сжатие геометрии (gltfpack) → проверка.
   И работа с папкой набора: items/<id>.json на каждый готовый товар, manifest.json — общий список. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyze, checkAgainst, shrinkTextures, wrapTransform } from './glb.mjs';
import { T, chooseForm } from './mapping.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let sharpMod = null;
export async function loadSharp() {
  if (sharpMod) return sharpMod;
  try { sharpMod = (await import('sharp')).default; } catch {
    throw new Error('Не найден пакет sharp. Выполните в папке tools/catalog: npm install');
  }
  return sharpMod;
}

/** Где лежит gltfpack: переменная GLTFPACK, затем npm‑пакет рядом, затем PATH. */
export function findGltfpack() {
  if (process.env.GLTFPACK) return { cmd: process.env.GLTFPACK, args: [] };
  for (const base of [path.join(HERE, '..'), process.cwd()]) {
    const cli = path.join(base, 'node_modules', 'gltfpack', 'cli.js');
    if (fs.existsSync(cli)) return { cmd: process.execPath, args: [cli] };
  }
  return { cmd: 'gltfpack', args: [] };
}

function run(cmd, args, { timeoutMs = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; const add = (d) => { out += d; if (out.length > 8000) out = out.slice(-8000); };
    p.stdout.on('data', add); p.stderr.on('data', add);
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('gltfpack: превышено время')); }, timeoutMs);
    p.on('error', (e) => { clearTimeout(timer); reject(e.code === 'ENOENT' ? new Error('Не найден gltfpack. Выполните в папке tools/catalog: npm install (или задайте путь в переменной GLTFPACK)') : e); });
    p.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error('gltfpack завершился с ошибкой: ' + out.trim().split('\n').slice(-2).join(' '))); });
  });
}

const sizeMmOf = (info) => ({ x: info.bbox.size[0] * 1000, y: info.bbox.size[1] * 1000, z: info.bbox.size[2] * 1000 });
const rot = (s, deg) => (deg % 180 === 0 ? s : { x: s.z, y: s.y, z: s.x });

/**
 * src — исходный GLB (Buffer). typeId — категория платформы. name — для выбора формы («round», «oval»…).
 * → { ok: true, buf, formId, dims, info, stats } | { ok: false, reason }
 */
export async function processModel(src, { typeId, name = '', maxTexture = 1024, maxTris = 30000, rotateY = 0, quality = 80 }) {
  let info;
  try { info = analyze(src); } catch (e) { return { ok: false, reason: 'модель не читается: ' + e.message }; }
  if (info.tris > 3000000) return { ok: false, reason: 'слишком тяжёлая модель: ' + info.tris + ' треугольников' };

  const turned = rot(sizeMmOf(info), rotateY);
  const form = chooseForm(typeId, turned, name);
  if (form.skip) return { ok: false, reason: form.skip };
  const totalRot = (rotateY + form.rotateY) % 360;
  const cur = rot(sizeMmOf(info), totalRot);
  const scale = [form.target.x / cur.x, form.target.y / cur.y, form.target.z / cur.z];

  const sharp = await loadSharp();
  let buf = wrapTransform(src, { rotateY: totalRot, scale });
  const tex = await shrinkTextures(buf, { maxSize: maxTexture, quality, sharp });
  buf = tex.buf;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-pack-'));
  try {
    const fin = path.join(tmp, 'in.glb'), fout = path.join(tmp, 'out.glb');
    fs.writeFileSync(fin, buf);
    const g = findGltfpack();
    const args = [...g.args, '-i', fin, '-o', fout, '-cc']; // EXT_meshopt_compression: его читает редактор и принимает сервер
    const ratio = info.tris > maxTris ? maxTris / info.tris : 1;
    if (ratio < 0.95) args.push('-si', ratio.toFixed(4));
    await run(g.cmd, args);
    buf = fs.readFileSync(fout);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  let outInfo;
  try { outInfo = analyze(buf); } catch (e) { return { ok: false, reason: 'после оптимизации модель не читается: ' + e.message }; }
  const fo = T.formOf(T.TYPE.get(typeId), form.formId);
  const ext = T.footprintExtents(fo.fp, form.dims);
  const check = checkAgainst(outInfo, { w: ext.w, d: ext.d, h: form.dims.H });
  if (!check.ok) return { ok: false, reason: 'габарит после оптимизации не совпал с размерами: ' + check.rows.filter((r) => !r.ok).map((r) => `${r.axis} ${r.modelMm}≠${r.expectedMm}`).join(', ') };
  return {
    ok: true, buf, formId: form.formId, dims: form.dims, info: outInfo,
    stats: { srcBytes: src.length, bytes: buf.length, srcTris: info.tris, tris: outInfo.tris, textures: tex.stats, rotateY: totalRot, scale: scale.map((s) => +s.toFixed(4)) },
  };
}

/* ---------- папка набора ---------- */

export function packPaths(dir) {
  const p = { dir, models: path.join(dir, 'models'), images: path.join(dir, 'images'), items: path.join(dir, 'items'), failed: path.join(dir, 'failed'), manifest: path.join(dir, 'manifest.json') };
  for (const d of [p.models, p.images, p.items, p.failed]) fs.mkdirSync(d, { recursive: true });
  return p;
}
export const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
export const writeJson = (f, v) => { fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 1)); fs.renameSync(f + '.tmp', f); };

/** Собирает manifest.json из items/*.json (только товары, чьи файлы на месте). */
export function writeManifest(p, meta = {}) {
  const items = [];
  for (const f of fs.readdirSync(p.items).filter((x) => x.endsWith('.json')).sort()) {
    const it = readJson(path.join(p.items, f));
    if (!it || !it.model || !fs.existsSync(path.join(p.dir, it.model.file))) continue;
    if (it.image && !fs.existsSync(path.join(p.dir, it.image.file))) delete it.image;
    items.push(it);
  }
  const bytes = items.reduce((s, it) => s + it.model.bytes + (it.image?.bytes || 0), 0);
  const byType = {}; for (const it of items) byType[it.typeId] = (byType[it.typeId] || 0) + 1;
  writeJson(p.manifest, { version: 1, generatedAt: new Date().toISOString(), ...meta, count: items.length, bytes, byType, items });
  return { count: items.length, bytes, byType };
}

export const mb = (n) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' МБ';

/** Выполняет задачи параллельно, не более limit одновременно. */
export async function pool(list, limit, worker) {
  let i = 0;
  const next = async () => { while (i < list.length) { const k = i++; await worker(list[k], k); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, next));
}
