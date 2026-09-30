/* Детерминированный генератор случайных чисел (ТЗ §19.6): зерно = хеш id запуска + номер замысла.
   Math.random и время в логике выбора не используются. */
'use strict';
function hashSeed(...parts) {
  const s = parts.map(String).join('|'); let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
/* mulberry32: быстрый, с хорошим распределением, 32-битное состояние */
function rng(seed) {
  let a = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (n) => Math.floor(next() * n), pick: (arr) => arr[Math.floor(next() * arr.length)], seed: a };
}
module.exports = { hashSeed, rng };
