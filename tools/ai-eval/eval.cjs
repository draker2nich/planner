'use strict';
/* Стенд ИИ‑дизайнера: прогоняет сценарии через весь путь генерации без браузера и считает, насколько хорошо модель
   справляется с расстановкой. Сервер поднимается в этом же процессе, геометрия — тот же код редактора (public/js/editor/ai).

   Запуск из корня проекта:
     AI_API_KEY=… node tools/ai-eval/eval.cjs            настоящая модель (расходует токены: 3–5 обращений на сценарий)
     AI_MOCK=1 node tools/ai-eval/eval.cjs               заглушка — проверить, что стенд и путь генерации работают
   Параметры:
     --only living,bedroom   только эти сценарии          --runs 3         сколько раз прогнать каждый сценарий
     --out DIR               куда писать отчёт и планы (по умолчанию tools/ai-eval/out)
     --dump                  сохранить запросы к модели и её ответы (для настройки текстов запросов)
     --again --refine        дополнительно проверить «заново» и «доработку» первого варианта
     --min-built 0.9         порог приёмки: доля построенных вариантов
     --max-auto 0.25         порог приёмки: доля предметов, место которым пришлось подбирать программой
   Код выхода 1 — пороги не выдержаны. */
const fs = require('node:fs');
const path = require('node:path');
const { makeApp } = require('../../server/test/helpers.js');
const { loadEditor } = require('../../server/test/editor-helpers.js');
const SCENARIOS = require('./scenarios.cjs');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const OUT = path.resolve(opt('out', path.join(__dirname, 'out')));
const RUNS = Math.max(1, Number(opt('runs', 1)) || 1);
const ONLY = opt('only', '').split(',').filter(Boolean);
const MIN_BUILT = Number(opt('min-built', 0.9)), MAX_AUTO = Number(opt('max-auto', 0.25));

const E = loadEditor();
const blank = (mode, extra) => Object.assign({ id: 'x', mode, wall: '', offset: 0, gap: 0, ref: '', side: 'none', shift: 0, face: 'auto', x: 0, y: 0, elev: -1 }, extra);

/* сценарий → проект редактора */
function buildProject(sc) {
  const pts = sc.room.poly || [[0, 0], [sc.room.w, 0], [sc.room.w, sc.room.h], [0, sc.room.h]];
  const vertices = pts.map((p, i) => ({ id: 'v' + (i + 1), x: p[0], y: p[1] }));
  const walls = vertices.map((v, i) => ({ id: 'w' + (i + 1), a: v.id, b: vertices[(i + 1) % vertices.length].id }));
  const P = { id: sc.id, vertices, walls, openings: [], wallHeight: 2700, wallThickness: 150, furniture: [], mode: 'furniture', unit: 'mm', floor: { material: { type: 'color', color: '#d9cfbf' } } };
  const ctx = E.call('aiCtx', P);
  if (!ctx) throw new Error(sc.id + ': контур комнаты не замкнут');
  const seq = { door: 0, window: 0, arch: 0 }, NAME = { door: 'Дверь', window: 'Окно', arch: 'Арка' };
  for (const o of sc.room.openings || []) { const wallId = ctx.wallId.get(o.wall); if (!wallId) throw new Error(`${sc.id}: нет стены ${o.wall}`); P.openings.push({ id: 'o' + (P.openings.length + 1), kind: o.kind, name: `${NAME[o.kind]} ${++seq[o.kind]}`, wallId, offset: o.offset, width: o.width, height: o.height, sill: o.sill, radius: o.radius, hinge: o.hinge, swing: o.swing }); }
  const c2 = E.call('aiCtx', P), TYPE = E.ev('TYPE'), PRODUCTS = E.ev('PRODUCTS');
  const policies = {};
  for (const it of sc.items) {
    const t = TYPE.get(it.type); if (!t) throw new Error(`${sc.id}: неизвестный тип ${it.type}`);
    const pr = it.product ? PRODUCTS.filter(p => p.typeId === it.type).sort((a, b) => (a.id < b.id ? -1 : 1))[0] : null;
    if (it.product && !pr) throw new Error(`${sc.id}: в каталоге нет товаров типа ${it.type}`);
    const fo = pr ? t.forms.find(f => f.id === pr.formId) : t.forms[0];
    const dims = pr ? Object.assign({}, pr.dims) : Object.assign({}, fo.typical, it.dims || {});
    const f = { id: it.id, typeId: t.id, formId: fo.id, productId: pr ? pr.id : null, formAny: false, name: pr ? pr.name : `${t.name} ${P.furniture.filter(x => x.typeId === t.id && !x.productId).length + 1}`, constraints: {}, dims, x: it.x || 0, y: it.y || 0, rot: it.rot || 0, mirror: false, locked: false, warnings: [] };
    const mount = fo.mount || t.mount;
    if (mount === 'wall') { f.elev = dims.E || 0; E.call('aiApplyFrame', f, E.call('aiResolve', blank('mount', { wall: it.wall, offset: it.offset || 0 }), f, c2), c2.d); }
    else if (mount === 'ontop') { const b = P.furniture.find(x => x.id === it.on); if (!b) throw new Error(`${sc.id}: нет основания ${it.on}`); f.baseId = b.id; f.x = b.x; f.y = b.y; f.rot = b.rot; }
    else if (it.wall) E.call('aiApplyFrame', f, E.call('aiResolve', blank('wall', { wall: it.wall, offset: it.offset || 0 }), f, c2), c2.d);
    P.furniture.push(f); policies[it.id] = it.policy || 'free';
  }
  return { P, policies };
}

/* план варианта картинкой — чтобы посмотреть глазами, не открывая редактор */
function svg(P, cell, base, title) {
  const d = E.call('derive', P), poly = d.cycle.map(id => d.V.get(id));
  const xs = poly.map(p => p.x), ys = poly.map(p => p.y), x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0, k = 0.12, pad = 40;
  const X = (p) => ((p.x - x0) * k + pad).toFixed(1), Y = (p) => ((p.y - y0) * k + pad + 24).toFixed(1);
  const path = (pts) => pts.map((p, i) => (i ? 'L' : 'M') + X(p) + ' ' + Y(p)).join(' ') + ' Z';
  const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const by = new Map((base || []).map(f => [f.id, f]));
  const Q = { vertices: P.vertices, walls: P.walls, openings: P.openings, wallHeight: P.wallHeight, furniture: cell };
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${(w * k + pad * 2).toFixed(0)}" height="${(h * k + pad * 2 + 24).toFixed(0)}" font-family="sans-serif" font-size="10"><rect width="100%" height="100%" fill="#fff"/><text x="${pad}" y="20" font-size="13" font-weight="600">${esc(title)}</text><path d="${path(poly)}" fill="#f4f4f5" stroke="#27272a" stroke-width="3"/>`;
  for (const o of P.openings) { const i = d.W.get(o.wallId); const a = { x: i.ref.x + i.rx * o.offset, y: i.ref.y + i.ry * o.offset }, b = { x: i.ref.x + i.rx * (o.offset + o.width), y: i.ref.y + i.ry * (o.offset + o.width) }; out += `<line x1="${X(a)}" y1="${Y(a)}" x2="${X(b)}" y2="${Y(b)}" stroke="${o.kind === 'window' ? '#2563eb' : '#fff'}" stroke-width="5"/>`; }
  const layer = (f) => ({ under: 0, floor: 1, ontop: 2 }[E.ev('TYPE').get(f.typeId).layer]);
  for (const f of [...cell].sort((a, b) => layer(a) - layer(b))) {
    const pts = E.call('fWorldOf', f, Q, d); if (!pts) continue;
    const b = by.get(f.id), ch = b && (b.productId !== f.productId || Math.abs(b.x - f.x) > 1 || Math.abs(b.y - f.y) > 1 || b.wallId !== f.wallId || b.offset !== f.offset);
    const fr = E.call('aiFrame', f, d), ay = E.call('aiAxes', fr.rot).ay, tip = { x: fr.x + ay.x * fr.d / 2, y: fr.y + ay.y * fr.d / 2 };
    out += `<path d="${path(pts)}" fill="${ch ? '#2563eb' : '#fff'}" fill-opacity="${layer(f) === 0 ? 0.08 : ch ? 0.18 : 0.9}" stroke="${ch ? '#2563eb' : '#52525b'}" ${f.productId ? '' : 'stroke-dasharray="4 3"'}/><circle cx="${X(tip)}" cy="${Y(tip)}" r="2" fill="${ch ? '#2563eb' : '#52525b'}"/><text x="${X(fr)}" y="${Y(fr)}" text-anchor="middle" fill="#18181b">${esc(E.ev('TYPE').get(f.typeId).name)}</text>`;
  }
  return out + '</svg>';
}

async function main() {
  const env = { MAIL_MODE: 'off', AI_DAILY_CALLS: '1000000' };
  for (const k of ['AI_API_KEY', 'AI_PROVIDER', 'AI_MODEL', 'AI_BASE_URL', 'AI_TIMEOUT_MS', 'AI_MOCK']) if (process.env[k]) env[k] = process.env[k];
  fs.mkdirSync(OUT, { recursive: true });
  let dumpN = 0;
  /* --dump: каждое обращение к модели сохраняется парой файлов «запрос / ответ» */
  const aiFetch = flag('dump') ? async (url, init) => {
    const n = String(++dumpN).padStart(3, '0'); const body = JSON.parse(init.body);
    const text = (body.messages || []).map(m => (Array.isArray(m.content) ? m.content.filter(c => c.type === 'text').map(c => c.text).join('\n') : m.content)).join('\n\n');
    fs.writeFileSync(path.join(OUT, `call-${n}-request.txt`), `--- system ---\n${typeof body.system === 'string' ? body.system : Array.isArray(body.system) ? body.system.map((x) => x.text).join('\n') : (body.messages[0] && body.messages[0].role === 'system' ? body.messages[0].content : '')}\n\n--- user ---\n${text}\n`);
    const r = await fetch(url, init); const j = await r.clone().json().catch(() => null);
    fs.writeFileSync(path.join(OUT, `call-${n}-response.json`), JSON.stringify(j, null, 2));
    return r;
  } : undefined;
  const quiet = console.log; console.log = () => {};
  const A = await makeApp(env, { aiFetch });
  console.log = quiet;
  if (!A.ctx.ai.enabled) { console.error('ИИ‑дизайнер не настроен: ' + A.ctx.ai.why + '. Задайте AI_API_KEY или AI_MOCK=1.'); A.close(); process.exit(2); }
  console.log(`Модель: ${A.ctx.ai.provider} · ${A.ctx.ai.model}${A.ctx.ai.mock ? ' (заглушка: цифры качества ничего не значат)' : ''}`);
  const u = await A.user('eval@example.test', { role: 'admin' });
  E.call('setProducts', await A.ctx.catalog.publicList(), 'server');
  console.log(`Каталог: ${E.ev('PRODUCTS').length} товаров\n`);
  const api = async (p, body) => { const r = await A.call('POST', '/api' + p, body, u.token); if (r.status !== 200) { const e = new Error((r.body.error && r.body.error.message) || 'HTTP ' + r.status); e.code = r.body.error && r.body.error.code; throw e; } return r.body; };

  const rows = [];
  for (const sc of SCENARIOS.filter(s => !ONLY.length || ONLY.includes(s.id))) {
    for (let run = 1; run <= RUNS; run++) {
      const tag = sc.id + (RUNS > 1 ? '#' + run : '');
      const { P, policies } = buildProject(sc);
      E.sandbox.__P = P; E.ev('P=__P;D=derive(P);');
      const brief = Object.assign({ photos: [], text: '', prefs: {}, room: {} }, sc.brief, { policies });
      const base = { furniture: JSON.parse(JSON.stringify(P.furniture)), finishes: E.call('aiFinishesOf', P) };
      const pre = E.call('aiPrecheck', new Map(Object.entries(policies)), brief.room, base.furniture);
      if (pre.errors.length) { console.log(`${tag}: сценарий не проходит проверку перед запуском — ${pre.errors[0]}`); rows.push({ tag, error: pre.errors[0] }); continue; }
      const passes = [['new', base, null]];
      let prev = null;
      const one = async (mode, start, from) => {
        const t0 = Date.now(), log0 = (await A.ctx.db.get("SELECT COALESCE(MAX(id),0) AS m FROM audit_log")).m;
        let out, error = null;
        try { out = await E.call('aiPipeline', { mode, brief, base, start, pre, prev, project: P, api, comment: mode === 'refine' ? 'Сделай расстановку свободнее' : '' }); }
        catch (e) { error = e.message; }
        const log = await A.ctx.db.all("SELECT action, data FROM audit_log WHERE entity='ai' AND id > ?", [log0]);
        const tok = log.reduce((s, x) => { const d = JSON.parse(x.data); return { in: s.in + (d.in || 0), out: s.out + (d.out || 0) }; }, { in: 0, out: 0 });
        const row = { tag: tag + (mode === 'new' ? '' : ':' + mode), ms: Date.now() - t0, calls: log.length, tokens: tok, error, variants: [] };
        for (const [i, c] of ((out && out.cells) || []).entries()) {
          const movable = start.furniture.filter(f => ['move', 'free'].includes(pre.policy.get(f.id)) && E.call('aiKind', f) !== 'ontop').length;
          const moved = c.furniture ? c.furniture.filter(f => { const b = start.furniture.find(x => x.id === f.id); return b && (Math.abs(b.x - f.x) > 1 || Math.abs(b.y - f.y) > 1 || b.wallId !== f.wallId || b.offset !== f.offset); }).length : 0;
          /* независимая перепроверка: у предметов, к которым прикасался ИИ, не должно остаться нарушений (кроме «перед окном» с замечанием) */
          const issues = [];
          if (c.furniture) { const cx = E.call('aiCtx', P); for (const f of c.furniture) { if ((pre.policy.get(f.id) || 'keep') === 'keep') continue; const b = start.furniture.find(x => x.id === f.id); const was = b ? E.call('aiIssues', b, start.furniture.filter(x => x.id !== f.id), cx) : []; for (const code of E.call('aiIssues', f, c.furniture.filter(x => x.id !== f.id), cx)) if (!was.includes(code)) issues.push(`${f.name}: ${code}`); } }
          row.variants.push({ title: c.title, built: !c.failed, failed: c.failed || null, movable, moved, issues, auto: (c.stats && c.stats.auto) || 0, retried: !!(c.stats && c.stats.retried), spare: (c.stats && c.stats.spare) || 0, dropped: (c.stats && c.stats.dropped) || 0, warnings: (c.warnings || []).map(w => w.text) });
          if (c.furniture) fs.writeFileSync(path.join(OUT, `${row.tag.replace(/[:#]/g, '-')}-v${i + 1}.svg`), svg(P, c.furniture, start.furniture, `${sc.title} — вариант ${i + 1}: ${c.title}`));
        }
        rows.push(row);
        const v = row.variants.map(x => x.built ? `построен (переставлено ${x.moved}/${x.movable}, программой ${x.auto}${x.retried ? ', повтор' : ''}${x.spare ? ', запасных товаров ' + x.spare : ''}${x.dropped ? ', без замены ' + x.dropped : ''}${x.warnings.length ? ', замечаний ' + x.warnings.length : ''}${x.issues.length ? ', НАРУШЕНИЯ: ' + x.issues.join('; ') : ''})` : 'НЕ ПОСТРОЕН: ' + x.failed);
        console.log(`${row.tag}: ${(row.ms / 1000).toFixed(1)} с, обращений ${row.calls}, токены ${tok.in}→${tok.out}${error ? ' — ОШИБКА: ' + error : ''}`); v.forEach((s, i) => console.log(`   вариант ${i + 1}: ${s}`));
        return out;
      };
      const first = await one('new', base, null);
      fs.writeFileSync(path.join(OUT, `${tag.replace('#', '-')}-base.svg`), svg(P, base.furniture, [], `${sc.title} — исходная расстановка`));
      if (first) prev = { taste: first.taste, variants: first.cells, prevVariants: null };
      if (first && flag('again')) await one('again', base, null);
      if (first && flag('refine') && first.cells[0] && !first.cells[0].failed) await one('refine', { furniture: first.cells[0].furniture, finishes: first.cells[0].finishes }, 0);
    }
  }
  A.close();
  const vs = rows.flatMap(r => r.variants || []);
  const built = vs.filter(v => v.built), movable = built.reduce((s, v) => s + v.movable, 0), auto = built.reduce((s, v) => s + v.auto, 0);
  const expected = rows.filter(r => !r.variants || !r.variants.length).length * 2 + vs.length;
  const sum = { runs: rows.length, variants: expected, built: built.length, issues: built.reduce((n, v) => n + v.issues.filter(t => !/: window$/.test(t)).length, 0), builtShare: expected ? built.length / expected : 0, autoShare: movable ? auto / movable : 0, retried: built.filter(v => v.retried).length,
    tokens: rows.reduce((s, r) => ({ in: s.in + ((r.tokens && r.tokens.in) || 0), out: s.out + ((r.tokens && r.tokens.out) || 0) }), { in: 0, out: 0 }), avgSeconds: rows.length ? rows.reduce((s, r) => s + (r.ms || 0), 0) / rows.length / 1000 : 0 };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), model: A.ctx.ai.model, thresholds: { minBuilt: MIN_BUILT, maxAuto: MAX_AUTO }, summary: sum, rows }, null, 2));
  console.log(`\nИтог: построено вариантов ${sum.built} из ${sum.variants} (${(sum.builtShare * 100).toFixed(0)} %, порог ${(MIN_BUILT * 100).toFixed(0)} %); место подбирала программа: ${(sum.autoShare * 100).toFixed(0)} % предметов (порог ${(MAX_AUTO * 100).toFixed(0)} %); повторных запросов: ${sum.retried}; в среднем ${sum.avgSeconds.toFixed(1)} с на генерацию; токены ${sum.tokens.in}→${sum.tokens.out}.`);
  console.log('Отчёт и планы: ' + OUT);
  if (sum.issues) console.log(`ВНИМАНИЕ: в построенных вариантах осталось нарушений правил расстановки: ${sum.issues} — это ошибка программы, а не модели.`);
  if (sum.builtShare < MIN_BUILT || sum.autoShare > MAX_AUTO || sum.issues) { console.log('Пороги приёмки НЕ выдержаны.'); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
