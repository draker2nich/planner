'use strict';
/* Обёртка над языковой моделью: формат запроса, разбор ответа, запасной путь без схемы, коды ошибок. Сеть подменена. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeAi, AiError, extractJson } = require('../core/ai.js');

const SCHEMA = { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'number' } } };
const reply = (status, json, headers = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => json, headers: { get: (k) => headers[k.toLowerCase()] || null } });
const anthropicOk = (text, extra = {}) => reply(200, { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 11, output_tokens: 7 }, ...extra });

test('без ключа ИИ‑дизайнер выключен и вызов даёт ai_off', async () => {
  const ai = makeAi({});
  assert.equal(ai.enabled, false);
  await assert.rejects(ai.call({ name: 'x', system: 's', text: 't', schema: SCHEMA }), (e) => e instanceof AiError && e.code === 'ai_off');
});

test('по умолчанию — Anthropic и claude-opus-5-5; модель и адрес меняются переменными', () => {
  const a = makeAi({ AI_API_KEY: 'k' });
  assert.deepEqual([a.enabled, a.provider, a.model], [true, 'anthropic', 'claude-opus-5-5']);
  const b = makeAi({ AI_API_KEY: 'k', AI_MODEL: 'claude-fable-5-1' });
  assert.equal(b.model, 'claude-fable-5-1');
  const c = makeAi({ AI_API_KEY: 'k', AI_PROVIDER: 'openai' });
  assert.equal(c.enabled, false, 'для стороннего сервиса модель нужно назвать');
  assert.equal(makeAi({ AI_API_KEY: 'k', AI_PROVIDER: 'nope' }).enabled, false);
});

test('Anthropic: структурированный вывод, ключ в заголовке, фото перед текстом', async () => {
  let seen;
  const ai = makeAi({ AI_API_KEY: 'secret' }, { fetchFn: async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return anthropicOk('{"a":5}'); } });
  const r = await ai.call({ name: 'taste', system: 'SYS', text: 'TXT', images: [{ mime: 'image/jpeg', data: 'AAAA' }], schema: SCHEMA, maxTokens: 123 });
  assert.deepEqual(r.data, { a: 5 });
  assert.deepEqual(r.usage, { in: 11, out: 7 });
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.init.headers['x-api-key'], 'secret');
  assert.equal(seen.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(seen.body.model, 'claude-opus-5-5');
  assert.equal(seen.body.max_tokens, 123);
  assert.equal(seen.body.system, 'SYS');
  assert.deepEqual(seen.body.output_config, { format: { type: 'json_schema', schema: SCHEMA } });
  assert.equal(seen.body.tool_choice, undefined, 'принудительный вызов инструмента новые модели не принимают');
  assert.deepEqual(seen.body.messages[0].content.map(c => c.type), ['image', 'text']);
  assert.deepEqual(seen.body.messages[0].content[0].source, { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' });
});

test('запрос со схемой отклонён (400) — повтор без схемы, JSON достаётся из текста', async () => {
  const bodies = [];
  const ai = makeAi({ AI_API_KEY: 'k' }, { fetchFn: async (url, init) => {
    const b = JSON.parse(init.body); bodies.push(b);
    return b.output_config ? reply(400, { error: { message: 'output_config is not supported with images' } }) : anthropicOk('Вот ответ:\n```json\n{"a": 9}\n```');
  } });
  const r = await ai.call({ name: 'taste', system: 's', text: 'вопрос', schema: SCHEMA });
  assert.deepEqual(r.data, { a: 9 });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].output_config, undefined);
  assert.match(bodies[1].messages[0].content.at(-1).text, /Ответь одним JSON/);
});

test('повтор без схемы — только на «запрос не принят» (400); 402, 404 и нечитаемый ответ не повторяются', async () => {
  for (const [status, code] of [[402, 'ai_request'], [404, 'ai_request'], [413, 'ai_request']]) {
    let n = 0;
    await assert.rejects(makeAi({ AI_API_KEY: 'k' }, { fetchFn: async () => { n++; return reply(status, { error: { message: 'x' } }); } }).call({ name: 'x', system: 's', text: 't', schema: SCHEMA }), (e) => e.code === code);
    assert.equal(n, 1, 'HTTP ' + status + ': одно обращение');
  }
  let n = 0;
  await assert.rejects(makeAi({ AI_API_KEY: 'k' }, { fetchFn: async () => { n++; return { ok: true, status: 200, json: async () => { throw new Error('не JSON'); }, headers: { get: () => null } }; } }).call({ name: 'x', system: 's', text: 't', schema: SCHEMA }), (e) => e.code === 'ai_bad_answer');
  assert.equal(n, 1);
  const odd = (json) => makeAi({ AI_API_KEY: 'k' }, { fetchFn: async () => reply(200, json) }).call({ name: 'x', system: 's', text: 't', schema: SCHEMA });
  await assert.rejects(odd({ content: {} }), (e) => e instanceof AiError && e.code === 'ai_bad_answer');
  await assert.rejects(makeAi({ AI_API_KEY: 'k', AI_PROVIDER: 'openai', AI_MODEL: 'm' }, { fetchFn: async () => reply(200, { choices: [{ message: { content: [null] } }] }) }).call({ name: 'x', system: 's', text: 't', schema: SCHEMA }), (e) => e instanceof AiError && e.code === 'ai_bad_answer');
});

test('коды ошибок: отказ, обрыв, ключ, перегрузка, сеть, не JSON', async () => {
  const run = (fetchFn) => makeAi({ AI_API_KEY: 'k' }, { fetchFn }).call({ name: 'x', system: 's', text: 't', schema: SCHEMA });
  const code = (c) => (e) => e instanceof AiError && e.code === c;
  await assert.rejects(run(async () => anthropicOk('', { stop_reason: 'refusal' })), code('ai_refused'));
  await assert.rejects(run(async () => anthropicOk('{"a":', { stop_reason: 'max_tokens' })), code('ai_truncated'));
  await assert.rejects(run(async () => reply(401, { error: { message: 'invalid x-api-key' } })), code('ai_auth'));
  await assert.rejects(run(async () => reply(529, { error: { type: 'overloaded_error' } })), code('ai_busy'));
  await assert.rejects(run(async () => reply(429, {}, { 'retry-after': '7' })), (e) => e.code === 'ai_busy' && e.retryAfter === 7);
  await assert.rejects(run(async () => { throw new Error('ECONNRESET'); }), code('ai_network'));
  await assert.rejects(run(async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; }), code('ai_timeout'));
  await assert.rejects(run(async () => anthropicOk('извините, не могу')), code('ai_bad_answer'));
  await assert.rejects(makeAi({ AI_API_KEY: 'k' }, { fetchFn: async () => anthropicOk('{}') }).call({ name: 'x', system: 's', text: 't', schema: SCHEMA, images: [{ mime: 'image/gif', data: 'A' }] }), code('ai_request'));
});

test('сервис с интерфейсом chat/completions: response_format и Bearer', async () => {
  let seen;
  const ai = makeAi({ AI_API_KEY: 'k', AI_PROVIDER: 'openai', AI_MODEL: 'some/model', AI_BASE_URL: 'https://example.test/v1/chat/completions' },
    { fetchFn: async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return reply(200, { choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } }); } });
  const r = await ai.call({ name: 'layout', system: 'S', text: 'T', schema: SCHEMA });
  assert.deepEqual(r.data, { a: 1 });
  assert.equal(seen.url, 'https://example.test/v1/chat/completions');
  assert.equal(seen.init.headers.authorization, 'Bearer k');
  assert.equal(seen.body.response_format.type, 'json_schema');
  assert.equal(seen.body.response_format.json_schema.name, 'layout');
  assert.equal(seen.body.messages[0].role, 'system');
  assert.equal(seen.body.max_tokens, 4000, 'предел длины ответа задан всегда');
});

test('заглушка: без сети и без ключа', async () => {
  const ai = makeAi({ AI_MOCK: '1' }, { mock: (name, input) => ({ name, input }), fetchFn: async () => { throw new Error('сеть не должна вызываться'); } });
  assert.deepEqual([ai.enabled, ai.mock, ai.model], [true, true, 'mock']);
  const r = await ai.call({ name: 'concept', system: 's', text: 't', schema: SCHEMA, mockInput: { q: 1 } });
  assert.deepEqual(r.data, { name: 'concept', input: { q: 1 } });
});

test('extractJson: чистый JSON и JSON внутри текста', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('текст {"a":{"b":2}} хвост'), { a: { b: 2 } });
  assert.throws(() => extractJson('нет'), (e) => e.code === 'ai_bad_answer');
});
