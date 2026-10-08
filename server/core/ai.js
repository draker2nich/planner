'use strict';
/* Обращение к языковой модели — единственное место, которое знает провайдера.
   Модель готовая, вызывается по API; своя модель не обучается и не размещается.

   Настройки (переменные окружения):
     AI_API_KEY     ключ провайдера; без него (и без AI_MOCK) ИИ‑дизайнер выключен
     AI_PROVIDER    anthropic (по умолчанию) | openai — любой сервис с интерфейсом chat/completions (OpenRouter и т. п.)
     AI_MODEL       идентификатор модели; для anthropic по умолчанию claude-opus-5-5
     AI_MODEL_TASTE, AI_MODEL_CONCEPT, AI_MODEL_LAYOUT
                    модель для отдельного шага (не задана — берётся AI_MODEL). Шаг «вкус» — разбор фото и текста в словарные
                    значения — обычно хорошо делает модель дешевле; качество расстановки проверяется стендом tools/ai-eval
     AI_RETRIES     сколько раз повторять запрос при перегрузке провайдера и сбое сети, по умолчанию 2 (0 — не повторять)
     AI_BASE_URL    адрес API, если он отличается от стандартного (обязателен для сторонних сервисов с интерфейсом openai)
     AI_TIMEOUT_MS  предел ожидания ответа, по умолчанию 45000: функция Vercel живёт 60 секунд
     AI_MOCK=1      режим‑заглушка: ответы строит server/core/ai-mock.js без обращения к сети (разработка и тесты)

   call() возвращает разобранный JSON по переданной схеме. Схемы пишутся в общем для провайдеров подмножестве JSON Schema:
   у каждого объекта additionalProperties:false и все свойства в required; без minimum/maximum/minLength/maxLength
   (их проверяет код после ответа).

   Кэш запросов (Anthropic): системный запрос каждого шага неизменен, поэтому помечается cache_control — повторные обращения
   в пределах пяти минут читают его из кэша дешевле обычного ввода. Запрос короче минимума модели просто не кэшируется.
   У сервисов с интерфейсом chat/completions кэш включается провайдером сам; число прочитанных из кэша токенов берётся из ответа.
   usage: in — весь ввод (включая кэш), out — вывод, cacheRead / cacheWrite — сколько из ввода прочитано из кэша и записано в него. */

class AiError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

const PROVIDERS = {
  anthropic: { url: 'https://api.anthropic.com/v1/messages', model: 'claude-opus-5-5' },
  openai: { url: 'https://api.openai.com/v1/chat/completions', model: '' },
};
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];

/* Первый JSON‑объект в тексте: запасной путь, когда ответ пришёл без ограничения схемой */
function extractJson(text) {
  const s = String(text || '');
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  throw new AiError('ai_bad_answer', 'Модель вернула ответ не в формате JSON');
}

function anthropicRequest({ model, system, text, images, schema, maxTokens, structured }) {
  const content = [...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } })), { type: 'text', text }];
  const body = { model, max_tokens: maxTokens, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content }] };
  /* Структурированный вывод: JSON по схеме приходит текстовым блоком. Принудительный вызов инструмента
     (tool_choice: tool) для моделей поколения 5.5 и 5.1 API не принимает, поэтому используется именно этот способ. */
  if (structured) body.output_config = { format: { type: 'json_schema', schema } };
  return body;
}
function anthropicAnswer(j) {
  if (j.stop_reason === 'refusal') throw new AiError('ai_refused', 'Модель отказалась отвечать на этот запрос');
  if (j.stop_reason === 'max_tokens') throw new AiError('ai_truncated', 'Ответ модели оборвался: не хватило длины');
  const block = (Array.isArray(j.content) ? j.content : []).find(b => b && b.type === 'text' && typeof b.text === 'string');
  if (!block) throw new AiError('ai_bad_answer', 'В ответе модели нет текста');
  /* input_tokens у Anthropic — только ввод после метки кэша; прочитанное из кэша и записанное в него считается отдельно */
  const fresh = Number(j.usage?.input_tokens) || 0, cacheRead = Number(j.usage?.cache_read_input_tokens) || 0, cacheWrite = Number(j.usage?.cache_creation_input_tokens) || 0;
  return { data: extractJson(block.text), usage: { in: fresh + cacheRead + cacheWrite, out: Number(j.usage?.output_tokens) || 0, cacheRead, cacheWrite } };
}

function openaiRequest({ model, system, text, images, schema, maxTokens, structured, name }) {
  const content = [{ type: 'text', text }, ...images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } }))];
  const body = { model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content }] };
  if (structured) body.response_format = { type: 'json_schema', json_schema: { name, strict: true, schema } };
  return body;
}
function openaiAnswer(j) {
  const ch = (Array.isArray(j.choices) ? j.choices : [])[0] || {};
  if (ch.finish_reason === 'length') throw new AiError('ai_truncated', 'Ответ модели оборвался: не хватило длины');
  if (ch.message && ch.message.refusal) throw new AiError('ai_refused', 'Модель отказалась отвечать на этот запрос');
  const c = ch.message && ch.message.content;
  const text = Array.isArray(c) ? c.map(p => (p && typeof p.text === 'string' ? p.text : '')).join('') : c;
  if (!text || typeof text !== 'string') throw new AiError('ai_bad_answer', 'В ответе модели нет текста');
  return { data: extractJson(text), usage: { in: Number(j.usage?.prompt_tokens) || 0, out: Number(j.usage?.completion_tokens) || 0, cacheRead: Number(j.usage?.prompt_tokens_details?.cached_tokens) || 0, cacheWrite: 0 } };
}

const STEPS = ['taste', 'concept', 'layout'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* mock(name, input) → объект ответа; передаётся снаружи, чтобы обёртка не зависела от предметной области.
   sleepFn подменяют тесты, чтобы повторы не ждали по‑настоящему. */
function makeAi(env = {}, { fetchFn = fetch, mock = null, sleepFn = wait } = {}) {
  const isMock = String(env.AI_MOCK || '').trim() === '1' && typeof mock === 'function';
  const provider = String(env.AI_PROVIDER || 'anthropic').trim().toLowerCase();
  const def = PROVIDERS[provider];
  const key = String(env.AI_API_KEY || '').trim();
  const model = String(env.AI_MODEL || (def && def.model) || '').trim();
  const url = String(env.AI_BASE_URL || (def && def.url) || '').trim();
  const timeoutMs = Math.max(5000, Math.min(280000, Number(env.AI_TIMEOUT_MS) || 45000));
  /* модель шага: AI_MODEL_<ШАГ> или общая */
  const models = Object.fromEntries(STEPS.map((k) => [k, String(env['AI_MODEL_' + k.toUpperCase()] || '').trim() || model]));
  const modelFor = (name) => (isMock ? 'mock' : models[name] || model);
  const retries = env.AI_RETRIES == null || env.AI_RETRIES === '' ? 2 : Math.max(0, Math.min(5, Math.floor(Number(env.AI_RETRIES)) || 0));
  const enabled = isMock || (!!def && !!key && !!model && !!url);
  const why = enabled ? null : !def ? `Неизвестный AI_PROVIDER «${provider}»` : !key ? 'Не задан AI_API_KEY' : !model ? 'Не задан AI_MODEL' : 'Не задан AI_BASE_URL';

  async function post(body, deadline) {
    const left = deadline - Date.now();
    if (left < 1500) throw new AiError('ai_timeout', 'Модель не успела ответить');
    const headers = provider === 'anthropic'
      ? { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }
      : { 'content-type': 'application/json', authorization: 'Bearer ' + key };
    let r;
    try { r = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(left) }); }
    catch (e) {
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new AiError('ai_timeout', 'Модель не успела ответить');
      throw new AiError('ai_network', 'Не удалось связаться с моделью: ' + (e && e.message || 'ошибка сети'));
    }
    let j = null; try { j = await r.json(); } catch {}
    if (r.ok && j && typeof j === 'object') return j;
    if (r.ok) throw new AiError('ai_bad_answer', 'Ответ провайдера не разобран');
    const detail = String((j && (j.error && (j.error.message || j.error.type) || j.message)) || ('HTTP ' + r.status)).slice(0, 300);
    if (r.status === 401 || r.status === 403) throw new AiError('ai_auth', 'Провайдер модели отклонил ключ: ' + detail, { status: r.status });
    if (r.status === 429 || r.status === 529 || r.status >= 500) throw new AiError('ai_busy', 'Модель сейчас перегружена: ' + detail, { status: r.status, retryAfter: Number(r.headers.get('retry-after')) || 0 });
    throw new AiError('ai_request', 'Провайдер не принял запрос: ' + detail, { status: r.status });
  }

  /* Перегрузка провайдера (429, 529, 5xx) и сбой сети — временные: запрос повторяется, пока позволяет срок ожидания.
     Пауза — та, что назвал провайдер (Retry-After), иначе растущая: 1,5 с, 4 с, 8 с. Если пауза не помещается в срок,
     ошибка отдаётся сразу: лучше быстрый отказ, чем функция, убитая по времени. */
  const BACKOFF = [1500, 4000, 8000];
  async function postRetry(body, deadline) {
    for (let attempt = 0; ; attempt++) {
      try { return await post(body, deadline); }
      catch (e) {
        if (!(e instanceof AiError) || (e.code !== 'ai_busy' && e.code !== 'ai_network') || attempt >= retries) throw e;
        const pause = e.retryAfter > 0 ? e.retryAfter * 1000 : BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
        if (deadline - Date.now() - pause < 5000) throw e;
        await sleepFn(pause);
      }
    }
  }

  /* name — имя шага (taste | concept | layout); images — [{mime, data(base64)}]; mockInput — исходные данные шага для заглушки */
  async function call({ name, system, text, images = [], schema, maxTokens = 4000, mockInput = null }) {
    if (!enabled) throw new AiError('ai_off', 'ИИ‑дизайнер не настроен: ' + why);
    const t0 = Date.now();
    if (isMock) {
      const data = await mock(name, mockInput);
      return { data, usage: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, ms: Date.now() - t0, model: 'mock' };
    }
    for (const i of images) if (!IMAGE_MIME.includes(i.mime)) throw new AiError('ai_request', 'Неподдерживаемый формат изображения');
    const deadline = t0 + timeoutMs;
    const build = provider === 'anthropic' ? anthropicRequest : openaiRequest;
    const parse = provider === 'anthropic' ? anthropicAnswer : openaiAnswer;
    const stepModel = modelFor(name);
    const args = { model: stepModel, system, text, images, schema, maxTokens, name };
    let j;
    try { j = await postRetry(build({ ...args, structured: true }), deadline); }
    catch (e) {
      /* Провайдер не принял запрос со схемой (например, сочетание со снимками): повторяем без ограничения схемой,
         схема уходит в текст запроса, а ответ всё равно проверяет код. */
      if (!(e instanceof AiError) || e.code !== 'ai_request' || e.status !== 400) throw e; // только «запрос не принят»: оплата, 404 и прочее повтором не лечатся
      const plain = text + '\n\nОтветь одним JSON‑объектом строго по этой схеме, без пояснений и без текста вокруг:\n' + JSON.stringify(schema);
      j = await postRetry(build({ ...args, text: plain, structured: false }), deadline);
    }
    const out = parse(j);
    return { data: out.data, usage: out.usage, ms: Date.now() - t0, model: stepModel };
  }

  return { enabled, mock: isMock, provider: isMock ? 'mock' : provider, model: isMock ? 'mock' : model, models: isMock ? {} : models, modelFor, retries, why, timeoutMs, call };
}

module.exports = { makeAi, AiError, extractJson, IMAGE_MIME, STEPS };
