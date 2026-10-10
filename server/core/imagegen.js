'use strict';
/* Обращение к модели, которая рисует изображения, — единственное место, которое знает её провайдера.
   Нужна визуализации комнаты (server/core/renders.js): на вход — кадр из 3D‑вида и образцы, на выход — одна картинка.
   Текстовый ИИ‑дизайнер сюда не относится: у него свой провайдер и свои настройки (server/core/ai.js).

   Настройки (переменные окружения):
     RENDER_API_KEY     ключ провайдера; без него (и без RENDER_MOCK) визуализация выключена
     RENDER_PROVIDER    google (по умолчанию) — Gemini API напрямую
     RENDER_MODEL       идентификатор модели; по умолчанию gemini-nano-banana-2.1
     RENDER_SIZE        размер результата: 1K (по умолчанию) или 2K. 4K не предлагается: ответ функции Vercel ограничен 4,5 МБ
     RENDER_THINKING    глубина «обдумывания» модели: minimal | low | medium | high; не задано — как решит провайдер.
                        Чем глубже, тем дольше ответ: если визуализация не укладывается во время жизни функции, поставьте minimal
     RENDER_TIMEOUT_MS  предел ожидания ответа, по умолчанию 50000: функция Vercel живёт 60 секунд, а результат ещё надо сохранить
     RENDER_RETRIES     повторы при перегрузке провайдера и сбое сети, по умолчанию 1 (0 — не повторять)
     RENDER_BASE_URL    адрес API, если он отличается от стандартного
     RENDER_MOCK=1      режим‑заглушка: «визуализацией» становится сам присланный кадр, без обращения к сети (разработка и тесты)

   Google: используется Interactions API (POST /v1beta/interactions) — его Google рекомендует для новых проектов,
   и примеры редактирования изображений в документации даны для него. Запрос не сохраняется у провайдера (store:false).
   API пока в статусе beta: если формат ответа изменится, править нужно только googleRequest и googleAnswer ниже.

   generate() возвращает { image: { mime, buf }, usage: { in, out }, ms, model }. Ошибки — AiError с теми же кодами,
   что у текстовой модели: их переводит в ответы API общий код в app.js. */
const { AiError } = require('./ai.js');

const PROVIDERS = {
  google: { url: 'https://generativelanguage.googleapis.com/v1beta/interactions', model: 'gemini-nano-banana-2.1' },
};
const SIZES = ['1K', '2K'];
const THINKING = ['minimal', 'low', 'medium', 'high'];
const ASPECTS = ['3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '1:1'];
const IN_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_OUT_BYTES = 3 * 1024 * 1024; // картинка отдаётся клиенту через функцию в base64: больше в ответ не поместится
const SIG = [
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8],
  ['image/png', (b) => b.readUInt32BE(0) === 0x89504e47],
  ['image/webp', (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'],
];
const mimeOf = (buf) => { const s = buf.length > 12 ? SIG.find(([, f]) => f(buf)) : null; return s ? s[0] : null; };
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* Текст идёт первым, изображения — в том порядке, в каком текст на них ссылается («Image 1», «Image 2»…).
   Правила (system) уходят в том же тексте, а не отдельным полем system_instruction: модели изображений принимают его не все. */
function googleRequest({ model, system, text, images, aspect, size, thinking }) {
  const body = {
    model,
    input: [{ type: 'text', text: system ? system + '\n\n' + text : text }, ...images.map((i) => ({ type: 'image', mime_type: i.mime, data: i.data }))],
    response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: aspect, image_size: size },
    store: false,
  };
  if (thinking) body.generation_config = { thinking_level: thinking };
  return body;
}
/* Ответ — список шагов. Промежуточные картинки «обдумывания» лежат в шагах thought; итог — последняя картинка шага model_output.
   Поле outputs — прежнее название того же списка (до переименования в steps), читается на случай старой версии API. */
function googleAnswer(j) {
  const errs = Array.isArray(j.errors) ? j.errors : [];
  const why = String((errs[0] && errs[0].message) || '').slice(0, 300);
  if (j.status === 'failed' || j.status === 'cancelled') throw new AiError('ai_request', 'Модель не построила изображение: ' + (why || j.status));
  const steps = Array.isArray(j.steps) ? j.steps : Array.isArray(j.outputs) ? [{ type: 'model_output', content: j.outputs }] : [];
  let img = null, said = '';
  for (const s of steps) {
    if (!s || s.type !== 'model_output') continue;
    for (const c of Array.isArray(s.content) ? s.content : []) {
      if (!c) continue;
      if (c.type === 'image' && typeof c.data === 'string' && c.data) img = c;
      else if (c.type === 'text' && typeof c.text === 'string') said += c.text;
    }
  }
  if (!img) {
    /* модель ответила словами или остановилась, не нарисовав: так выглядит отказ по правилам содержания */
    if (said.trim() || j.status === 'incomplete') throw new AiError('ai_refused', 'Модель не стала рисовать: ' + (said.trim().slice(0, 200) || why || j.status));
    throw new AiError('ai_bad_answer', 'В ответе модели нет изображения');
  }
  const u = j.usage || {};
  return { data: img.data, usage: { in: num(u.total_input_tokens), out: num(u.total_output_tokens) + num(u.total_thought_tokens), cacheRead: 0, cacheWrite: 0 } };
}

/* mock({ images }) → { mime, buf }; передаётся снаружи. sleepFn подменяют тесты, чтобы повторы не ждали по‑настоящему. */
function makeImageAi(env = {}, { fetchFn = fetch, mock = null, sleepFn = wait } = {}) {
  const isMock = String(env.RENDER_MOCK || '').trim() === '1' && typeof mock === 'function';
  const provider = String(env.RENDER_PROVIDER || 'google').trim().toLowerCase();
  const def = PROVIDERS[provider];
  const key = String(env.RENDER_API_KEY || '').trim();
  const model = String(env.RENDER_MODEL || (def && def.model) || '').trim();
  const url = String(env.RENDER_BASE_URL || (def && def.url) || '').trim();
  const sizeRaw = String(env.RENDER_SIZE || '1K').trim().toUpperCase();
  const size = SIZES.includes(sizeRaw) ? sizeRaw : '1K';
  const thinkingRaw = String(env.RENDER_THINKING || '').trim().toLowerCase();
  const thinking = THINKING.includes(thinkingRaw) ? thinkingRaw : '';
  const timeoutMs = Math.max(5000, Math.min(280000, Number(env.RENDER_TIMEOUT_MS) || 50000));
  const retries = env.RENDER_RETRIES == null || env.RENDER_RETRIES === '' ? 1 : Math.max(0, Math.min(3, Math.floor(Number(env.RENDER_RETRIES)) || 0));
  const enabled = isMock || (!!def && !!key && !!model && !!url);
  const why = enabled ? null : !def ? `Неизвестный RENDER_PROVIDER «${provider}»` : !key ? 'Не задан RENDER_API_KEY' : !model ? 'Не задан RENDER_MODEL' : 'Не задан RENDER_BASE_URL';

  async function post(body, deadline) {
    const left = deadline - Date.now();
    if (left < 1500) throw new AiError('ai_timeout', 'Модель не успела ответить');
    let r;
    try { r = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body), signal: AbortSignal.timeout(left) }); }
    catch (e) {
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new AiError('ai_timeout', 'Модель не успела ответить');
      throw new AiError('ai_network', 'Не удалось связаться с моделью: ' + ((e && e.message) || 'ошибка сети'));
    }
    let j = null; try { j = await r.json(); } catch {}
    if (r.ok && j && typeof j === 'object') return j;
    if (r.ok) throw new AiError('ai_bad_answer', 'Ответ провайдера не разобран');
    const detail = String((j && (j.error && (j.error.message || j.error.status) || j.message)) || ('HTTP ' + r.status)).slice(0, 300);
    if (r.status === 401 || r.status === 403) throw new AiError('ai_auth', 'Провайдер модели отклонил ключ: ' + detail, { status: r.status });
    if (r.status === 429 || r.status === 529 || r.status >= 500) throw new AiError('ai_busy', 'Модель сейчас перегружена: ' + detail, { status: r.status, retryAfter: Number(r.headers.get('retry-after')) || 0 });
    throw new AiError('ai_request', 'Провайдер не принял запрос: ' + detail, { status: r.status });
  }
  /* Перегрузка провайдера и сбой сети — временные: повтор, пока позволяет срок. За неудачную попытку провайдер денег не берёт. */
  async function postRetry(body, deadline) {
    for (let attempt = 0; ; attempt++) {
      try { return await post(body, deadline); }
      catch (e) {
        if (!(e instanceof AiError) || (e.code !== 'ai_busy' && e.code !== 'ai_network') || attempt >= retries) throw e;
        const pause = e.retryAfter > 0 ? e.retryAfter * 1000 : 2000;
        if (deadline - Date.now() - pause < 15000) throw e; // на саму картинку нужно время: короткий остаток срока повтор не спасёт
        await sleepFn(pause);
      }
    }
  }

  /* images — [{ mime, data(base64) }], первое — кадр, который нужно превратить в визуализацию; aspect — соотношение сторон результата */
  async function generate({ system, text, images = [], aspect = '3:2' }) {
    if (!enabled) throw new AiError('ai_off', 'Визуализация не настроена: ' + why);
    const t0 = Date.now();
    if (!images.length) throw new AiError('ai_request', 'Нет кадра для визуализации');
    for (const i of images) if (!IN_MIME.includes(i.mime)) throw new AiError('ai_request', 'Неподдерживаемый формат изображения');
    if (isMock) {
      const out = await mock({ system, text, images, aspect });
      return { image: out, usage: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, ms: Date.now() - t0, model: 'mock' };
    }
    const j = await postRetry(googleRequest({ model, system, text, images, aspect: ASPECTS.includes(aspect) ? aspect : '3:2', size, thinking }), t0 + timeoutMs);
    const out = googleAnswer(j);
    const buf = Buffer.from(out.data, 'base64');
    const mime = mimeOf(buf);
    if (!mime) throw new AiError('ai_bad_answer', 'Модель вернула не изображение');
    if (buf.length > MAX_OUT_BYTES) throw new AiError('ai_bad_answer', `Изображение модели больше ${MAX_OUT_BYTES >> 20} МБ: уменьшите RENDER_SIZE`);
    return { image: { mime, buf }, usage: out.usage, ms: Date.now() - t0, model };
  }

  return { enabled, mock: isMock, provider: isMock ? 'mock' : provider, model: isMock ? 'mock' : model, size, thinking, retries, why, timeoutMs, generate };
}

module.exports = { makeImageAi, googleRequest, googleAnswer, mimeOf, ASPECTS, IN_MIME, MAX_OUT_BYTES };
