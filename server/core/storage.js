'use strict';
/* Хранилище файлов (3D‑модели, фото). Один интерфейс для двух драйверов:
   - fs   — локально, папка data/uploads, файлы раздаются сервером по /files/…;
   - blob — на Vercel, Vercel Blob (публичный store), файлы раздаются с *.public.blob.vercel-storage.com.
   put(key, buffer, contentType) → url;  remove(url);  read(url) → Buffer;  owns(url, prefix) → файл наш и лежит в prefix. */
const fs = require('node:fs');
const path = require('node:path');

function fsStorage(dir) {
  fs.mkdirSync(dir, { recursive: true });
  // старые записи хранили относительный путь «products/…» — приводим к URL
  const toUrl = (ref) => !ref ? null : (/^(https?:)?\//.test(ref) ? ref : '/files/' + ref.split(path.sep).join('/'));
  const toPath = (ref) => {
    const rel = toUrl(ref).replace(/^\/files\//, '');
    const p = path.resolve(dir, rel);
    if (!p.startsWith(path.resolve(dir) + path.sep)) throw new Error('bad path');
    return p;
  };
  return {
    kind: 'fs', dir, urlOf: toUrl,
    async put(key, buf) { const p = toPath(key); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); return toUrl(key); },
    async remove(ref) { if (!ref) return; try { fs.rmSync(toPath(ref), { force: true }); } catch {} },
    async removePrefix(prefix) { fs.rmSync(path.join(dir, prefix), { recursive: true, force: true }); },
    async read(ref) { return fs.readFileSync(toPath(ref)); },
    owns(ref, prefix) { try { return toUrl(ref).startsWith('/files/' + prefix); } catch { return false; } },
  };
}

/* blobSdk — модуль @vercel/blob (передаётся снаружи: на Vercel — настоящий, в тестах — заглушка) */
function blobStorage(blobSdk, fetchFn = fetch) {
  const isOurs = (url) => { try { const u = new URL(url); return u.protocol === 'https:' && u.hostname.endsWith('.public.blob.vercel-storage.com'); } catch { return false; } };
  return {
    kind: 'blob', urlOf: (ref) => ref || null,
    async put(key, buf, contentType) {
      const r = await blobSdk.put(key, buf, { access: 'public', contentType, addRandomSuffix: true });
      return r.url;
    },
    async remove(url) { if (url && isOurs(url)) { try { await blobSdk.del(url); } catch (e) { console.warn('blob del', e.message); } } },
    async removePrefix(prefix) {
      let cursor;
      do { const r = await blobSdk.list({ prefix, cursor, limit: 1000 }); if (r.blobs.length) await blobSdk.del(r.blobs.map(b => b.url)); cursor = r.hasMore ? r.cursor : undefined; } while (cursor);
    },
    async read(url) {
      if (!isOurs(url)) throw new Error('Файл не из хранилища платформы');
      const r = await fetchFn(url); if (!r.ok) throw new Error('Не удалось прочитать файл: ' + r.status);
      return Buffer.from(await r.arrayBuffer());
    },
    owns(url, prefix) { if (!isOurs(url)) return false; try { return new URL(url).pathname.slice(1).startsWith(prefix); } catch { return false; } },
  };
}

module.exports = { fsStorage, blobStorage };
