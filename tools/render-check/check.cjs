'use strict';
/* Проверка визуализации на настоящей модели, без браузера и без сервера: кадр из файла → картинка в файл.
   Нужна, чтобы убедиться, что ключ и модель работают, посмотреть время ответа и расход и сравнить модели на своих кадрах.
   Каждый запуск — платное обращение к модели.

   Запуск из корня проекта (настройки берутся из .env — те же, что у сервера):
     node --env-file=.env tools/render-check/check.cjs кадр.jpg
     node --env-file=.env tools/render-check/check.cjs кадр.jpg --anchor готовая.jpg --ref диван.jpg --ref стол.jpg --evening --out результат.jpg
     RENDER_MODEL=gemini-3-pro-image node --env-file=.env tools/render-check/check.cjs кадр.jpg      # другая модель на том же кадре
   Кадр — снимок 3D‑вида 3:2. Проще всего взять его из редактора: запустить сервер с RENDER_MOCK=1, создать визуализацию
   и нажать «Скачать» (на заглушке «визуализацией» становится сам кадр). --dump печатает текст запроса и ничего не отправляет. */
const fs = require('node:fs');
const path = require('node:path');
const { makeImageAi, mimeOf } = require('../../server/core/imagegen.js');
const { buildPrompt } = require('../../server/core/renders.js');

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const values = (name) => { const out = []; for (let i = args.indexOf(name); i >= 0; i = args.indexOf(name)) { out.push(args[i + 1]); args.splice(i, 2); } return out; };
const dump = flag('--dump'), evening = flag('--evening');
const anchors = values('--anchor'), refs = values('--ref'), out = values('--out')[0];
const frame = args[0];
if (!frame || args.length > 1 || [...anchors, ...refs].some((f) => !f)) { console.error('Использование: node --env-file=.env tools/render-check/check.cjs кадр.jpg [--anchor готовая.jpg] [--ref фото‑товара.jpg …] [--evening] [--out результат.jpg] [--dump]'); process.exit(2); }
const load = (file) => { const buf = fs.readFileSync(file); const mime = mimeOf(buf); if (!mime) throw new Error(file + ': нужен JPG, PNG или WebP'); return { mime, data: buf.toString('base64') }; };

(async () => {
  /* сцена без подробностей: размеры комнаты не названы, отделка «как в кадре», предметы не перечислены — в редакторе всё это называет браузер */
  const asShown = { type: 'photo' };
  const prompt = buildPrompt({ mood: evening ? 'evening' : 'day', anchor: anchors.length > 0, products: refs.map(() => ({ typeId: 'furniture', colors: [], materials: [] })),
    scene: { area: 0, height: 0, walls: [asShown], floor: asShown, ceiling: asShown, items: [], windows: 0, doors: 0 } });
  if (dump) { console.log('--- system ---\n' + prompt.system + '\n\n--- text ---\n' + prompt.text); return; }
  const ai = makeImageAi(process.env);
  if (!ai.enabled) throw new Error('Визуализация не настроена: ' + ai.why + '. Задайте RENDER_API_KEY в .env');
  const images = [load(frame), ...anchors.slice(0, 1).map(load), ...refs.map(load)];
  console.log(`Модель ${ai.model}, размер ${ai.size}${ai.thinking ? ', обдумывание ' + ai.thinking : ''}; изображений в запросе: ${images.length}. Ждём до ${Math.round(ai.timeoutMs / 1000)} с…`);
  const res = await ai.generate({ ...prompt, images, aspect: '3:2' });
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[res.image.mime];
  const file = out || path.join(path.dirname(frame), path.basename(frame, path.extname(frame)) + '.' + ai.model.replace(/[^\w.-]+/g, '_') + ext);
  fs.writeFileSync(file, res.image.buf);
  console.log(`Готово за ${(res.ms / 1000).toFixed(1)} с: ${file} (${Math.round(res.image.buf.length / 1024)} КБ). Токены: ввод ${res.usage.in}, вывод ${res.usage.out}.`);
  if (res.ms > 45000) console.log('Ответ шёл дольше 45 с: на Vercel функция живёт 60 с. Поставьте RENDER_THINKING=minimal или увеличьте maxDuration в vercel.json и RENDER_TIMEOUT_MS.');
})().catch((e) => { console.error('Не получилось: ' + (e.code ? e.code + ': ' : '') + e.message); process.exit(1); });
