import test from 'node:test';
import assert from 'node:assert/strict';
import { T, matchType, chooseForm, colorsOf, materialsOf, stylesOf, cleanName, syntheticPrice, headOf } from '../lib/mapping.mjs';
import { planItem } from '../lib/abo.mjs';
import { writeGlb, parseGlb, wrapTransform, analyze, checkAgainst } from '../lib/glb.mjs';

const type = (name, sourceType, sizeMm) => { const r = matchType({ name, sourceType, sizeMm }); return r.typeId || 'skip:' + r.skip; };

test('тип: мебель распознаётся по главной части названия', () => {
  assert.equal(type('Amazon Brand – Rivet Revolve Modern Upholstered Sofa Couch, 80"W, Grey', 'SOFA'), 'sofa');
  assert.equal(type('Stone & Beam Table Lamp with Shade', 'LAMP'), 'table-lamp');
  assert.equal(type('Rivet Office Desk Chair, Black', 'CHAIR'), 'office-chair');
  assert.equal(type('Modern Coffee Table with Storage', 'TABLE'), 'coffee-table');
  assert.equal(type('Bedside Table, Walnut', 'TABLE'), 'nightstand');
  assert.equal(type('Sofa Table for Entryway', 'TABLE'), 'console');
  assert.equal(type('Counter Height Stool, Set of 2', 'STOOL_SEATING'), 'bar-stool');
  assert.equal(type('Round Ottoman Pouf', 'OTTOMAN'), 'pouf');
  assert.equal(type('End of Bed Storage Bench', 'BENCH'), 'bench');
  assert.equal(type('Queen Platform Bed Frame', 'BED'), 'bed');
  assert.equal(type('Area Rug 5x8, Blue', 'RUG'), 'rug');
  assert.equal(type('Full Length Floor Mirror', 'HOME_MIRROR'), 'mirror');
  assert.equal(type('5-Tier Ladder Shelf', 'SHELF'), 'shelving');
  assert.equal(type('TV Stand for 65 inch TVs', 'HOME_FURNITURE_AND_DECOR'), 'tv-stand');
});

test('тип: ширина отличает кресло от стула, высота — пуф от барного стула и шкаф от буфета', () => {
  assert.equal(type('Dining Chair', 'CHAIR', { x: 480, y: 900, z: 520 }), 'chair');
  assert.equal(type('Dining Chair', 'CHAIR', { x: 820, y: 900, z: 800 }), 'armchair');
  assert.equal(type('Wooden Stool', 'STOOL_SEATING', { x: 350, y: 450, z: 350 }), 'pouf');
  assert.equal(type('Wooden Stool', 'STOOL_SEATING', { x: 350, y: 750, z: 350 }), 'bar-stool');
  assert.equal(type('Storage Cabinet', 'CABINET', { x: 800, y: 1800, z: 400 }), 'wardrobe');
  assert.equal(type('Storage Cabinet', 'CABINET', { x: 800, y: 900, z: 400 }), 'sideboard');
});

test('тип: не мебель и аксессуары отсекаются', () => {
  assert.match(type('Mens Leather Boots, Brown', 'SHOES'), /^skip:не мебель/);
  assert.match(type('Phone Case for iPhone', 'CELLULAR_PHONE_CASE'), /^skip:не мебель/);
  assert.match(type('Decorative Throw Pillow Cover for Sofa', 'HOME'), /^skip/);
  assert.match(type('Non-Slip Rug Pad', 'RUG'), /^skip:аксессуар/);
  assert.match(type('Pet Bed for Large Dogs', 'HOME'), /^skip/);
  assert.match(type('Chair Cushion, Set of 4', 'HOME'), /^skip:аксессуар/);
  assert.match(type('Scented Candle', 'HOME'), /^skip/);
  assert.equal(headOf('Rivet Sofa with Removable Cushions, Grey'), 'rivet sofa');
});

test('все типы из правил есть в справочнике платформы', () => {
  for (const [name, st] of [['Sofa', 'SOFA'], ['Chair', 'CHAIR'], ['Table', 'TABLE'], ['Bed', 'BED'], ['Rug', 'RUG'], ['Lamp', 'LAMP'], ['x', 'OTTOMAN'], ['x', 'BENCH'], ['x', 'DRESSER'], ['x', 'DESK'], ['x', 'MIRROR'], ['x', 'SHELF'], ['x', 'CABINET'], ['x', 'NIGHTSTAND'], ['x', 'PLANTER'], ['x', 'WALL_ART']]) {
    const r = matchType({ name, sourceType: st });
    assert.ok(T.TYPE.has(r.typeId), `${st} → ${r.typeId || r.skip}`);
  }
});

test('форма и размеры по габариту модели', () => {
  assert.deepEqual(chooseForm('sofa', { x: 2032.4, y: 863.6, z: 889 }, 'Sofa'), { formId: 'straight', dims: { H: 864, W: 2032, D: 889 }, target: { x: 2032, y: 864, z: 889 }, rotateY: 0 });
  assert.equal(chooseForm('bed', { x: 1650, y: 1100, z: 2100 }, 'Queen Bed').formId, 'double');
  assert.equal(chooseForm('bed', { x: 1950, y: 1100, z: 2100 }, 'King Bed').formId, 'king');
  assert.deepEqual(chooseForm('bed', { x: 1000, y: 900, z: 2000 }, 'Twin Bed').dims, { H: 900, W: 1000, L: 2000 });
  // круглое: стороны выравниваются по большей
  const lamp = chooseForm('floor-lamp', { x: 380, y: 1600, z: 400 }, 'Floor Lamp');
  assert.deepEqual([lamp.formId, lamp.dims, lamp.target], ['round', { H: 1600, DIA: 400 }, { x: 400, y: 1600, z: 400 }]);
  assert.equal(chooseForm('floor-lamp', { x: 300, y: 1800, z: 1100 }, 'Arc Floor Lamp').skip, 'не круглый в плане');
  assert.equal(chooseForm('coffee-table', { x: 900, y: 450, z: 900 }, 'Round Coffee Table').formId, 'round');
  assert.equal(chooseForm('coffee-table', { x: 1100, y: 450, z: 600 }, 'Coffee Table').formId, 'rect');
  assert.equal(chooseForm('table', { x: 1600, y: 750, z: 950 }, 'Oval Dining Table').formId, 'oval');
  // ковёр тоньше минимального размера платформы — толщина поднимается до 10 мм
  assert.deepEqual(chooseForm('rug', { x: 2400, y: 4, z: 1600 }, 'Area Rug').dims, { H: 10, W: 2400, D: 1600 });
  // настенное зеркало, смоделированное боком, разворачивается; высота установки берётся типовая
  const mir = chooseForm('mirror', { x: 30, y: 900, z: 600 }, 'Wall Mirror');
  assert.deepEqual([mir.formId, mir.rotateY, mir.dims], ['wall', 90, { H: 900, W: 600, D: 30, E: 1200 }]);
  assert.equal(chooseForm('mirror', { x: 500, y: 1700, z: 50 }, 'Full Length Floor Mirror').formId, 'floor');
  assert.equal(chooseForm('picture', { x: 800, y: 30, z: 600 }, 'Canvas Wall Art').skip, 'плоский предмет лежит плашмя');
  // подушка, попавшая в диваны, и модель в сантиметрах вместо метров
  assert.equal(chooseForm('sofa', { x: 450, y: 120, z: 450 }, 'Sofa').skip, 'размер не похож на тип');
  assert.equal(chooseForm('chair', { x: 45000, y: 90000, z: 50000 }, 'Chair').skip, 'размер не похож на тип');
});

test('каждая выбранная форма проходит серверную сверку модели с размерами', () => {
  for (const [typeId, size, name] of [['sofa', { x: 2032, y: 864, z: 889 }, ''], ['floor-lamp', { x: 380, y: 1600, z: 400 }, ''], ['rug', { x: 2400, y: 4, z: 1600 }, ''], ['mirror', { x: 30, y: 900, z: 600 }, 'wall'], ['small-table', { x: 500, y: 550, z: 500 }, 'round side table'], ['bed', { x: 1650, y: 1100, z: 2100 }, '']]) {
    const f = chooseForm(typeId, size, name);
    const fo = T.formOf(T.TYPE.get(typeId), f.formId), e = T.footprintExtents(fo.fp, f.dims);
    const info = { bbox: { min: [-f.target.x / 2000, 0, -f.target.z / 2000], max: [f.target.x / 2000, f.target.y / 1000, f.target.z / 2000], size: [f.target.x / 1000, f.target.y / 1000, f.target.z / 1000] }, tris: 1 };
    assert.ok(checkAgainst(info, { w: e.w, d: e.d, h: f.dims.H }).ok, typeId);
  }
});

test('атрибуты для ИИ‑подбора', () => {
  assert.deepEqual(colorsOf('Navy Blue'), ['синий']);
  assert.deepEqual(colorsOf('Charcoal / Espresso'), ['серый', 'коричневый']);
  assert.deepEqual(materialsOf('Velvet, Solid Wood'), ['дерево', 'велюр']);
  assert.deepEqual(materialsOf('Faux Leather'), ['кожа']);
  assert.deepEqual(stylesOf('Mid-Century Modern'), ['современный']);
  assert.deepEqual(stylesOf('Industrial Farmhouse'), ['лофт', 'кантри']);
  assert.equal(cleanName('Amazon Brand – Rivet Revolve Modern Upholstered Sofa Couch, 80"W, Grey Weave'), 'Rivet Revolve Modern Upholstered Sofa Couch');
  assert.ok(cleanName('x'.repeat(300)).length <= 120);
});

test('условная цена стабильна и зависит от размера', () => {
  const a = { id: 'abo-1', typeId: 'sofa', formId: 'straight', dims: { W: 2200, D: 900, H: 850 }, brand: 'Rivet' };
  assert.equal(syntheticPrice(a), syntheticPrice({ ...a }));
  assert.ok(syntheticPrice({ ...a, dims: { W: 3200, D: 1100, H: 850 } }) > syntheticPrice({ ...a, dims: { W: 1500, D: 800, H: 850 } }));
  assert.ok(syntheticPrice(a) > 10000 && syntheticPrice(a) < 250000);
});

test('карточка ABO → товар: бренд не попадает в материалы, ссылка и адреса файлов собираются', () => {
  const p = planItem({ modelId: 'B07B4DBBVX', modelPath: 'X/B07B4DBBVX.glb', extent: [2.03, 0.86, 0.89], faces: 40000, itemId: 'B07B4DBBVX', domain: 'amazon.com',
    name: 'Stone & Beam Bradbury Chesterfield Tufted Leather Sofa Couch, 92.9"W, Brown', brand: 'Stone & Beam', sourceType: 'SOFA', color: 'Brown', material: 'Leather', style: 'Traditional', imagePath: 'ab/abcdef.jpg' });
  assert.equal(p.id, 'abo-B07B4DBBVX'); assert.equal(p.typeId, 'sofa');
  assert.deepEqual([p.colors, p.materials, p.styleTags], [['коричневый'], ['кожа'], ['классика']]);
  assert.equal(p.url, 'https://www.amazon.com/dp/B07B4DBBVX');
  assert.match(p.modelUrl, /\/3dmodels\/original\/X\/B07B4DBBVX\.glb$/); assert.match(p.imageUrl, /\/images\/small\/ab\/abcdef\.jpg$/);
  assert.equal(planItem({ modelId: 'B0', modelPath: 'x', extent: [0.3, 0.1, 0.3], name: 'Leather Boots', brand: '', sourceType: 'SHOES', color: '', material: '', style: '' }).skip, 'не мебель: SHOES');
});

test('словари: всё, что выдаёт сопоставление, есть в словарях платформы', () => {
  for (const v of colorsOf.values) assert.equal(T.dictValue('colors', v), v, 'цвет вне словаря: ' + v);
  for (const v of materialsOf.values) assert.equal(T.dictValue('materials', v), v, 'материал вне словаря: ' + v);
  for (const v of stylesOf.values) assert.equal(T.dictValue('styles', v), v, 'стиль вне словаря: ' + v);
  assert.equal(new Set(T.COLORS.map((c) => c.name)).size, T.COLORS.length);
});

/* минимальный GLB: один треугольник с габаритом 1 × 2 × 0.5 м */
function tinyGlb() {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0.5]);
  const bin = Buffer.from(pos.buffer);
  return writeGlb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 2, 0.5] }], bufferViews: [{ buffer: 0, byteLength: bin.length }], buffers: [{ byteLength: bin.length }] }, bin);
}

test('GLB: запись читается обратно, поворот и масштаб дают нужный габарит', () => {
  const src = tinyGlb();
  assert.deepEqual(analyze(src).bbox.size, [1, 2, 0.5]);
  assert.equal(parseGlb(src).json.nodes.length, 1);
  const r = analyze(wrapTransform(src, { rotateY: 90, scale: [2, 0.5, 3] })).bbox.size.map((v) => +v.toFixed(6));
  assert.deepEqual(r, [1, 1, 3]); // после поворота x↔z: 0.5×2×1, затем масштаб 2 / 0.5 / 3
  assert.equal(wrapTransform(src, { rotateY: 0, scale: [1, 1, 1] }), src);
});
