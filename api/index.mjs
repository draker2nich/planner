/* Функция Vercel: весь API (/api/*) обслуживает одна функция.
   vercel.json переписывает /api/<путь> → /api/index?__p=<путь>, поэтому исходный путь берём из __p. */
import core from '../server/core/app.js';

const { createApp, fromEnv, ApiError } = core;
const app = createApp(() => fromEnv(process.env, { dataDir: '/tmp/planner-data' }));

async function handler(request) {
  const url = new URL(request.url);
  const sub = url.searchParams.get('__p');
  url.searchParams.delete('__p');
  const pathname = sub != null ? '/api/' + sub.replace(/^\/+/, '') : url.pathname;
  let bodyP = null;
  const r = await app.handle({
    method: request.method,
    pathname,
    query: Object.fromEntries(url.searchParams),
    header: (n) => request.headers.get(n),
    body: async (limit) => {
      const buf = await (bodyP ||= request.arrayBuffer().then(b => Buffer.from(b)));
      if (buf.length > limit) throw new ApiError(413, 'too_large', `Файл больше ${Math.round(limit / 1048576)} МБ`);
      return buf;
    },
    webRequest: () => request,
  });
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...(r.headers || {}) } });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
