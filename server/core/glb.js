'use strict';
/* Разбор GLB (glTF 2.0 binary) без зависимостей: проверка формата, габарит сцены в метрах, число треугольников.
   Соглашение платформы для моделей: Y вверх, метры, перед по +Z, начало координат — центр низа футпринта. */

const MAGIC = 0x46546c67, CHUNK_JSON = 0x4e4f534a, CHUNK_BIN = 0x004e4942;
const UNSUPPORTED_EXT = { KHR_draco_mesh_compression: 'сжатие Draco', EXT_meshopt_compression: 'сжатие meshopt' };

class GlbError extends Error { constructor(code, message) { super(message); this.code = code; } }

function parse(buf) {
  if (buf.length < 20 || buf.readUInt32LE(0) !== MAGIC) throw new GlbError('not_glb', 'Файл не является GLB (glTF binary)');
  const version = buf.readUInt32LE(4);
  if (version !== 2) throw new GlbError('bad_version', `Нужен glTF 2.0, в файле версия ${version}`);
  const total = buf.readUInt32LE(8);
  if (total > buf.length) throw new GlbError('truncated', 'Файл обрезан');
  let off = 12, json = null, bin = null;
  while (off + 8 <= total) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(data.toString('utf8'));
    else if (type === CHUNK_BIN && !bin) bin = data;
    off += 8 + len;
  }
  if (!json) throw new GlbError('no_json', 'В GLB нет JSON‑части');
  for (const ext of json.extensionsRequired || []) {
    if (UNSUPPORTED_EXT[ext]) throw new GlbError('unsupported_ext', `Модель использует ${UNSUPPORTED_EXT[ext]} — пока не поддерживается. Экспортируйте без сжатия.`);
  }
  return { json, bin };
}

/* ---- матрицы 4×4, column‑major как в glTF ---- */
const I = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
function mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
function trs(n) {
  if (n.matrix) return n.matrix.slice();
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * sx, (2 * (xy + wz)) * sx, (2 * (xz - wy)) * sx, 0,
    (2 * (xy - wz)) * sy, (1 - 2 * (xx + zz)) * sy, (2 * (yz + wx)) * sy, 0,
    (2 * (xz + wy)) * sz, (2 * (yz - wx)) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const apply = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

function accessorMinMax(json, bin, idx) {
  const a = json.accessors[idx];
  if (a.min && a.max && a.min.length >= 3) return { min: a.min, max: a.max };
  // по спецификации min/max обязательны для POSITION; запасной путь — прочитать float‑вершины
  if (a.componentType !== 5126 || a.bufferView == null || !bin) throw new GlbError('no_bounds', 'У вершин модели нет границ (min/max) — пересохраните файл');
  const bv = json.bufferViews[a.bufferView];
  const stride = bv.byteStride || 12, base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < a.count; i++) for (let k = 0; k < 3; k++) { const v = bin.readFloatLE(base + i * stride + k * 4); if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  return { min, max };
}

function analyze(buf) {
  const { json, bin } = parse(buf);
  const sceneIdx = json.scene ?? 0;
  const scene = json.scenes?.[sceneIdx];
  if (!scene) throw new GlbError('no_scene', 'В модели нет сцены');
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let tris = 0, meshes = 0;
  const visit = (ni, parent) => {
    const n = json.nodes[ni]; const m = mul(parent, trs(n));
    if (n.mesh != null) {
      meshes++;
      for (const pr of json.meshes[n.mesh].primitives) {
        const pos = pr.attributes?.POSITION; if (pos == null) continue;
        const mm = accessorMinMax(json, bin, pos);
        for (let c = 0; c < 8; c++) {
          const p = apply(m, [c & 1 ? mm.max[0] : mm.min[0], c & 2 ? mm.max[1] : mm.min[1], c & 4 ? mm.max[2] : mm.min[2]]);
          for (let k = 0; k < 3; k++) { if (p[k] < min[k]) min[k] = p[k]; if (p[k] > max[k]) max[k] = p[k]; }
        }
        const mode = pr.mode ?? 4;
        if (mode === 4) tris += Math.floor((pr.indices != null ? json.accessors[pr.indices].count : json.accessors[pos].count) / 3);
      }
    }
    for (const c of n.children || []) visit(c, m);
  };
  for (const ni of scene.nodes || []) visit(ni, I());
  if (!meshes || !isFinite(min[0])) throw new GlbError('empty', 'В модели нет геометрии');
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return {
    bbox: { min, max, size },
    tris, meshes,
    materials: (json.materials || []).length,
    textures: (json.textures || []).length,
    generator: json.asset?.generator || '',
  };
}

/* Сверка габарита модели с размерами товара.
   expected — мм: w (по X), d (по Z), h (по Y). Допуск — 2 % или 5 мм. */
function checkAgainst(info, expected, tolPct = 2) {
  const s = info.bbox.size.map(v => v * 1000); // → мм
  const axis = [['X (ширина)', s[0], expected.w], ['Y (высота)', s[1], expected.h], ['Z (глубина)', s[2], expected.d]];
  const within = (a, b) => Math.abs(a - b) <= Math.max(b * tolPct / 100, 5);
  const rows = axis.map(([name, model, exp]) => ({ axis: name, modelMm: Math.round(model), expectedMm: Math.round(exp), ok: within(model, exp) }));
  const ok = rows.every(r => r.ok);
  const hints = [];
  if (!ok) {
    const ratio = s[1] / expected.h;
    if (ratio > 500 && ratio < 2000) hints.push('Похоже, модель в миллиметрах — экспортируйте в метрах (Scale 0.001).');
    else if (ratio > 50 && ratio < 200) hints.push('Похоже, модель в сантиметрах — экспортируйте в метрах (Scale 0.01).');
    else if (within(s[0], expected.d) && within(s[2], expected.w) && within(s[1], expected.h)) hints.push('Ширина и глубина поменяны местами — модель повёрнута на 90°. Перед модели должен смотреть по +Z (в Blender — по −Y).');
    else if (within(s[1], expected.d) && within(s[2], expected.h)) hints.push('Модель лежит на боку: высота должна идти по Y (в Blender — по Z). Проверьте настройку «+Y Up» при экспорте.');
    else hints.push('Размеры модели не совпадают с размерами товара. Исправьте размеры товара или загрузите другую модель.');
  }
  const warn = [];
  const b = info.bbox;
  if (Math.abs(b.min[1]) > 0.01) warn.push('Низ модели не на нуле по Y — редактор поставит модель на пол сам.');
  if (Math.abs((b.min[0] + b.max[0]) / 2) > 0.02 || Math.abs((b.min[2] + b.max[2]) / 2) > 0.02) warn.push('Центр модели смещён от начала координат — редактор отцентрирует её сам.');
  if (info.tris > 150000) warn.push(`Много треугольников: ${info.tris.toLocaleString('ru')} (рекомендуется до 150 000) — 3D может тормозить.`);
  return { ok, rows, hints, warn, tolerancePct: tolPct };
}

module.exports = { analyze, checkAgainst, GlbError };
