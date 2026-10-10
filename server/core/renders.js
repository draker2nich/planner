'use strict';
/* Визуализация комнаты: кадр из 3D‑вида редактора → фотореалистичная картинка от модели, которая рисует изображения.

   Один запрос — одна картинка (функция Vercel живёт 60 секунд). Браузер присылает:
     кадр      снимок 3D‑вида фиксированного размера, без подписей и служебных значков;
     сцену     что в кадре, значениями из словарей: отделка, типы и число предметов, размеры комнаты;
     образцы   фото товаров из каталога, которые стоят в кадре, — чтобы модель не «придумывала» их внешний вид;
     образец стиля (необязательно) — уже готовая визуализация этого проекта: новый ракурс рисуется в том же стиле.
   Текст запроса к модели собирается здесь и только из проверенных значений: свободного текста от пользователя в нём нет.

   Готовая картинка принадлежит проекту. Файл лежит в хранилище платформы под ключом users/<пользователь>/renders/…,
   в таблице renders — сведения о нём. Адрес файла наружу не отдаётся, как и у фото пользователя: картинка читается
   через API с проверкой прав (владелец; поддержка; гость по ссылке на проект). */
const crypto = require('node:crypto');
const T = require('../../public/shared/catalog-types.js');
const { ApiError } = require('./catalog.js');
const { mimeOf, ASPECTS, IN_MIME } = require('./imagegen.js');

const LIM = {
  body: 4 * 1024 * 1024,       // запрос к функции Vercel ограничен 4,5 МБ
  frameChars: 1800 * 1024,     // кадр в base64
  refChars: 300 * 1024,        // одно фото товара в base64 (браузер уменьшает его до 512 пикселей)
  refs: 8, items: 40, wallFinishes: 4, label: 60,
  perProject: 12,              // визуализаций в одном проекте; лишние пользователь удаляет сам
};
const MOODS = ['day', 'evening'];
const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const HEX_RE = /^#[0-9a-f]{6}$/;
const now = () => new Date().toISOString();
const J = (s, d) => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : d; } catch { return d; } };

/* Английские названия для запроса к модели: идентификаторы текстур — те же, что в FINISH_TEXTURES и TEXLIB редактора */
const TEXTURE_EN = {
  plaster: 'light plaster', 'paint-warm': 'warm beige matte paint', 'paint-cool': 'cool grey-blue matte paint',
  'wp-stripes': 'striped wallpaper', 'wp-dots': 'polka-dot wallpaper', 'wp-damask': 'wallpaper with a diamond pattern',
  'tile-white': 'white ceramic tiles', 'tile-grey': 'grey ceramic tiles', 'tile-mosaic': 'blue mosaic tiles',
  'wood-oak': 'light oak wood planks', 'wood-dark': 'dark walnut wood planks', laminate: 'grey laminate planks',
  stone: 'natural stone', concrete: 'concrete', brick: 'red brick',
};
const COLOR_EN = {
  'белый': 'white', 'бежевый': 'beige', 'серый': 'grey', 'чёрный': 'black', 'коричневый': 'brown', 'натуральное дерево': 'natural wood',
  'синий': 'blue', 'зелёный': 'green', 'красный': 'red', 'оранжевый': 'orange', 'жёлтый': 'yellow', 'розовый': 'pink',
  'фиолетовый': 'purple', 'серебристый': 'silver', 'прозрачный': 'transparent', 'разноцветный': 'multicoloured',
};
const MATERIAL_EN = {
  'дерево': 'wood', 'ЛДСП / МДФ': 'laminated board', 'металл': 'metal', 'стекло': 'glass', 'кожа': 'leather', 'велюр': 'velvet',
  'ткань': 'fabric', 'ковровое волокно': 'carpet fibre', 'ротанг': 'rattan', 'камень': 'stone', 'пластик': 'plastic',
};
const typeEn = (id) => String(id).replace(/-/g, ' '); // идентификаторы типов — английские слова: coffee-table, tv-stand

/* ---------- проверка входных данных ---------- */
const bad = (message) => new ApiError(422, 'validation', message);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function only(b, keys, where) {
  if (!isObj(b)) throw bad(`${where}: ожидается объект`);
  for (const k of Object.keys(b)) if (!keys.includes(k)) throw bad(`${where}: лишнее поле «${String(k).slice(0, 40)}»`);
  return b;
}
function int(v, min, max, where) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${where}: ожидается число от ${min} до ${max}`);
  return n;
}
/* Картинка в base64: формат определяется по содержимому, а не по тому, что заявил клиент */
function image(v, maxChars, where) {
  only(v, ['mime', 'data'], where);
  if (typeof v.data !== 'string' || !v.data) throw bad(`${where}: нет данных изображения`);
  if (v.data.length > maxChars) throw new ApiError(413, 'too_large', `${where}: изображение слишком большое`);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v.data)) throw bad(`${where}: изображение повреждено`);
  const mime = mimeOf(Buffer.from(v.data.slice(0, 24), 'base64'));
  if (!mime || !IN_MIME.includes(mime)) throw new ApiError(415, 'bad_image', `${where}: нужен JPG, PNG или WebP`);
  return { mime, data: v.data };
}
/* Отделка поверхности: цвет, встроенная текстура редактора или своё фото пользователя (само фото видно в кадре) */
function finish(v, where) {
  if (!isObj(v)) throw bad(`${where}: ожидается объект`);
  if (v.type === 'photo') return { type: 'photo' };
  if (v.type === 'texture') {
    if (!Object.prototype.hasOwnProperty.call(TEXTURE_EN, String(v.textureId))) throw bad(`${where}: неизвестная текстура`);
    return { type: 'texture', textureId: String(v.textureId) };
  }
  const color = String(v.color || '').toLowerCase();
  if (v.type !== 'color' || !HEX_RE.test(color)) throw bad(`${where}: ожидается цвет #rrggbb, текстура или фото`);
  return { type: 'color', color };
}
function readScene(v) {
  only(v, ['area', 'height', 'walls', 'floor', 'ceiling', 'items', 'windows', 'doors'], 'scene');
  if (!Array.isArray(v.walls) || !v.walls.length || v.walls.length > LIM.wallFinishes) throw bad(`scene.walls: от 1 до ${LIM.wallFinishes} вариантов отделки`);
  if (!Array.isArray(v.items) || v.items.length > LIM.items) throw bad(`scene.items: не больше ${LIM.items} типов предметов`);
  const area = Number(v.area);
  if (!Number.isFinite(area) || area <= 0 || area > 2000) throw bad('scene.area: площадь комнаты в м²');
  return {
    area: Math.round(area * 10) / 10,
    height: int(v.height, 1500, 6000, 'scene.height'),
    walls: v.walls.map((w, i) => finish(w, `scene.walls[${i}]`)),
    floor: finish(v.floor, 'scene.floor'),
    ceiling: finish(v.ceiling, 'scene.ceiling'),
    items: v.items.map((it, i) => {
      only(it, ['typeId', 'n'], `scene.items[${i}]`);
      if (!T.TYPE.has(String(it.typeId))) throw bad(`scene.items[${i}]: неизвестный тип предмета`);
      return { typeId: String(it.typeId), n: int(it.n, 1, 99, `scene.items[${i}].n`) };
    }),
    windows: int(v.windows ?? 0, 0, 40, 'scene.windows'),
    doors: int(v.doors ?? 0, 0, 40, 'scene.doors'),
  };
}
function readReq(b) {
  only(b, ['frame', 'aspect', 'mood', 'label', 'anchorId', 'scene', 'refs'], 'Запрос');
  const aspect = b.aspect == null ? '3:2' : String(b.aspect);
  if (!ASPECTS.includes(aspect)) throw bad('aspect: неподдерживаемое соотношение сторон');
  const mood = b.mood == null ? 'day' : String(b.mood);
  if (!MOODS.includes(mood)) throw bad('mood: day или evening');
  if (b.label != null && typeof b.label !== 'string') throw bad('label: ожидается строка');
  /* подпись — только для списка визуализаций (название варианта ИИ‑дизайнера); в запрос к модели она не попадает */
  const label = String(b.label || '').replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LIM.label);
  let anchorId = null;
  if (b.anchorId != null && b.anchorId !== '') { if (!ID_RE.test(String(b.anchorId))) throw bad('anchorId: некорректный идентификатор'); anchorId = String(b.anchorId); }
  const refsIn = b.refs == null ? [] : b.refs;
  if (!Array.isArray(refsIn) || refsIn.length > LIM.refs) throw bad(`refs: не больше ${LIM.refs} фото товаров`);
  const seen = new Set(), refs = [];
  refsIn.forEach((r, i) => {
    only(r, ['productId', 'mime', 'data'], `refs[${i}]`);
    const productId = String(r.productId || '');
    if (!productId || productId.length > 80) throw bad(`refs[${i}]: нет товара`);
    if (seen.has(productId)) return; seen.add(productId);
    refs.push({ productId, ...image({ mime: r.mime, data: r.data }, LIM.refChars, `refs[${i}]`) });
  });
  return { frame: image(b.frame, LIM.frameChars, 'frame'), aspect, mood, label, anchorId, scene: readScene(b.scene), refs };
}

/* ---------- запрос к модели ---------- */
const SYSTEM = [
  'You are an architectural visualisation renderer. The first image is a raw real-time 3D screenshot of a furnished room exported from a room-planning tool. Turn it into one photorealistic interior photograph of exactly the same room.',
  '',
  'Keep unchanged:',
  '- the camera: position, viewing direction, lens and framing; vertical lines stay vertical;',
  '- the room: walls, corners, ceiling height, doors, windows and openings stay where they are and keep their size;',
  '- every piece of furniture and every object: same place, same orientation, same size, same shape, same colour and material. Do not add, remove, move, merge, resize or restyle anything;',
  '- the colours and materials of the walls, the floor and the ceiling.',
  '',
  'Improve only what a 3D preview lacks: physically plausible lighting and global illumination, soft shadows and contact shadows, realistic material detail (fabric weave, wood grain, gloss, reflections), natural depth and a believable view outside the windows.',
  '',
  'Never add objects that are not in the screenshot: no extra furniture, plants, pictures, curtains, rugs, lamps, books, people or animals. No text, captions, logos, watermarks or frames. Return exactly one image.',
].join('\n');

function finishText(m, surface) {
  if (m.type === 'photo') return 'a custom finish, exactly as it appears in the screenshot';
  if (m.type === 'texture') return TEXTURE_EN[m.textureId];
  return (surface === 'floor' ? 'plain floor covering' : 'matte paint') + `, colour ${m.color}`;
}
/* Подпись фото товара: тип, цвета и материалы из каталога. Названия и бренда нет — как и в запросах ИИ‑дизайнера. */
function productText(p) {
  const colors = (p.colors || []).map((c) => COLOR_EN[T.dictValue('colors', c)]).filter(Boolean);
  const mats = (p.materials || []).map((m) => MATERIAL_EN[T.dictValue('materials', m)]).filter(Boolean);
  const extra = [colors.join(', '), mats.join(', ')].filter(Boolean).join('; ');
  return typeEn(p.typeId) + (extra ? ` (${extra})` : '');
}
/* products — карточки каталога для образцов, в том же порядке, что изображения; anchor — приложена ли готовая визуализация.
   Порядок изображений в запросе: кадр, образец стиля (если есть), фото товаров. */
function buildPrompt({ scene, mood, products = [], anchor = false }) {
  const L = ['Image 1 is the 3D screenshot to render.'];
  let n = 2;
  if (anchor) { L.push(`Image ${n} is an approved render of this same room from another camera position. Match it exactly in materials, lighting, colour grading and the look of every object, but keep the camera and composition of Image 1.`); n++; }
  if (products.length) {
    const list = products.map((p, i) => `Image ${n + i} — ${productText(p)}`).join('; ');
    L.push(`${products.length === 1 ? `Image ${n} is a catalogue photo of a product` : `Images ${n}–${n + products.length - 1} are catalogue photos of products`} that stand in the room: ${list}. Use them only to reproduce how these products look. They are not extra objects: do not insert them into the scene.`);
  }
  L.push('');
  const openings = [scene.windows ? `${scene.windows} ${scene.windows === 1 ? 'window' : 'windows'}` : '', scene.doors ? `${scene.doors} ${scene.doors === 1 ? 'door' : 'doors'}` : ''].filter(Boolean).join(', ');
  if (scene.area) L.push(`Room: about ${scene.area} m², ceiling height ${(scene.height / 1000).toFixed(2)} m${openings ? ', ' + openings : ''}.`);
  const walls = [...new Set(scene.walls.map((w) => finishText(w, 'wall')))];
  L.push(walls.length === 1 ? `Walls: ${walls[0]}.` : `Walls (different walls have different finishes, as in the screenshot): ${walls.join('; ')}.`);
  L.push(`Floor: ${finishText(scene.floor, 'floor')}.`);
  L.push(`Ceiling: ${finishText(scene.ceiling, 'ceiling')}.`);
  /* список — подсказка, что есть что; рисовать нужно только то, что действительно видно в кадре (предмет может быть заслонён другим) */
  if (scene.items.length) L.push(`Furniture in the screenshot: ${scene.items.map((it) => `${typeEn(it.typeId)} ×${it.n}`).join(', ')}. Render only what the screenshot actually shows.`);
  L.push(mood === 'evening'
    ? 'Lighting: warm evening interior light, the lamps that are present in the room are switched on, dusk outside the windows.'
    : 'Lighting: soft natural daylight coming through the windows, neutral white balance, balanced exposure.');
  L.push('Style of the picture: interior photography for a furniture catalogue, wide-angle lens, eye level, sharp, natural colours.');
  return { system: SYSTEM, text: L.join('\n') };
}

/* Заглушка модели (RENDER_MOCK=1): «визуализацией» становится сам кадр */
const mock = async ({ images }) => ({ mime: images[0].mime, buf: Buffer.from(images[0].data, 'base64') });

/* ---------- хранение ---------- */
function makeRenders(db, storage) {
  const checkId = (id) => { if (!ID_RE.test(String(id || ''))) throw new ApiError(422, 'validation', 'Некорректный идентификатор визуализации'); return String(id); };
  const notFound = () => new ApiError(404, 'not_found', 'Визуализация не найдена');
  const dto = (r) => { const m = J(r.meta, {}); return { id: r.id, createdAt: r.created_at, mime: r.mime, bytes: Number(r.bytes), label: m.label || '', mood: MOODS.includes(m.mood) ? m.mood : 'day', anchor: m.anchor || null }; };
  const rowOf = (projectId, id) => db.get('SELECT * FROM renders WHERE project_id=? AND id=?', [String(projectId), checkId(id)]);
  async function bytesOf(r) {
    try { return await storage.read(r.file); } catch (e) { console.error('render read:', e.message); throw notFound(); }
  }
  let gcAt = new Map();

  return {
    LIM,
    /* Все обращения — по идентификатору проекта: право на сам проект проверяет вызывающий маршрут */
    async list(projectId) {
      const rows = await db.all('SELECT id, mime, bytes, meta, created_at FROM renders WHERE project_id=? ORDER BY created_at, id', [String(projectId)]);
      return rows.map(dto);
    },
    async count(projectId) {
      return Number((await db.get('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM renders WHERE project_id=?', [String(projectId)])).c);
    },
    /* → { id, mime, bytes, data } — картинка в base64, как у фото пользователя */
    async read(projectId, id) {
      const r = await rowOf(projectId, id);
      if (!r) throw notFound();
      const buf = await bytesOf(r);
      return { id: r.id, mime: r.mime, bytes: buf.length, data: buf.toString('base64') };
    },
    /* Готовая визуализация как образец стиля для нового ракурса → { mime, data, mood } */
    async source(projectId, id) {
      const r = await rowOf(projectId, id);
      if (!r) throw new ApiError(404, 'not_found', 'Визуализация‑образец не найдена: возможно, её удалили');
      const buf = await bytesOf(r);
      return { id: r.id, mime: r.mime, data: buf.toString('base64'), mood: dto(r).mood };
    },
    async save(user, projectId, img, meta) {
      const id = crypto.randomBytes(12).toString('base64url');
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[img.mime] || 'jpg';
      const file = await storage.put(`users/${user.id}/renders/${id}.${ext}`, img.buf, img.mime);
      const t = now();
      try {
        await db.run('INSERT INTO renders (id,user_id,project_id,file,mime,bytes,meta,created_at) VALUES (?,?,?,?,?,?,?,?)', [id, user.id, String(projectId), file, img.mime, img.buf.length, JSON.stringify(meta || {}), t]);
      } catch (e) { await storage.remove(file); throw e; }
      return dto({ id, mime: img.mime, bytes: img.buf.length, meta: JSON.stringify(meta || {}), created_at: t });
    },
    async remove(projectId, id) {
      const r = await rowOf(projectId, id);
      if (!r) return { ok: true, removed: false };
      await db.run('DELETE FROM renders WHERE id=?', [r.id]);
      await storage.remove(r.file);
      return { ok: true, removed: true };
    },
    /* Визуализации проектов, которых больше нет (стёрты из корзины или по сроку), убираются вместе с файлами.
       Проект в корзине свои визуализации сохраняет: его можно восстановить. throttleSec — не чаще, чем раз в столько секунд на процесс. */
    async gc(userId, throttleSec = 0) {
      if (throttleSec) {
        if (Date.now() - (gcAt.get(userId) || 0) < throttleSec * 1000) return 0;
        if (gcAt.size > 5000) gcAt = new Map();
        gcAt.set(userId, Date.now());
      }
      try {
        const rows = await db.all('SELECT r.id, r.file FROM renders r LEFT JOIN projects p ON p.id = r.project_id WHERE r.user_id = ? AND p.id IS NULL', [userId]);
        for (const r of rows) { await db.run('DELETE FROM renders WHERE id=?', [r.id]); await storage.remove(r.file); }
        return rows.length;
      } catch (e) { console.error('renders gc:', e.message); return 0; }
    },
  };
}

module.exports = { makeRenders, readReq, buildPrompt, productText, mock, LIM, MOODS, SYSTEM };
