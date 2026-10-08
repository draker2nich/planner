'use strict';
/* Сценарии стенда: комната, расстановка заказчика, права и пожелания. Размеры — в миллиметрах.
   Стены прямоугольной комнаты: W1 — верхняя, W2 — правая, W3 — нижняя, W4 — левая; отступы — от начала стены
   (у W1 и W3 — от левого края, у W2 и W4 — от верхнего).
   Предмет: type, policy (keep | move | replace | free), product: true — стоит товар из каталога (иначе пустышка),
   место: wall + offset (спиной к стене) либо x, y, rot; on — id предмета‑основания; dims — свои размеры пустышки. */
const rect = (w, h, openings) => ({ w, h, openings });
const win = (wall, offset, width = 1500, sill = 900, height = 1400) => ({ kind: 'window', wall, offset, width, height, sill });
const door = (wall, offset, width = 900, swing = 'in') => ({ kind: 'door', wall, offset, width, height: 2000, swing, hinge: 'left' });
const arch = (wall, offset, width = 1200) => ({ kind: 'arch', wall, offset, width, height: 2100, radius: 0 });

module.exports = [
  { id: 'living', title: 'Гостиная 5×4 м: всё пустышками посреди комнаты',
    room: rect(5000, 4000, [win('W1', 1700), door('W3', 400)]),
    items: [
      { id: 'sofa', type: 'sofa', x: 2500, y: 2300, policy: 'free' }, { id: 'table', type: 'coffee-table', x: 2500, y: 1100, policy: 'free' },
      { id: 'arm1', type: 'armchair', x: 900, y: 1000, policy: 'free' }, { id: 'arm2', type: 'armchair', x: 900, y: 2600, policy: 'free' },
      { id: 'tvs', type: 'tv-stand', x: 3800, y: 3000, policy: 'free' }, { id: 'rug', type: 'rug', x: 3300, y: 1500, policy: 'free' },
      { id: 'lamp', type: 'floor-lamp', x: 4500, y: 500, policy: 'free' }, { id: 'light', type: 'chandelier', x: 1200, y: 3300, policy: 'free' },
      { id: 'pic', type: 'picture', wall: 'W2', offset: 300, policy: 'free' },
    ],
    brief: { text: 'Светлая спокойная гостиная, диван напротив телевизора, побольше дерева', prefs: { style: 'Скандинавский', palette: 'Светлая', budget: 'Средний' }, room: { walls: 'ai', floor: 'ai', ceiling: 'ai' } } },

  { id: 'bedroom', title: 'Спальня 4×3,5 м: кровать стоит товаром и заперта, остальное подбирается',
    room: rect(4000, 3500, [win('W1', 1200), door('W2', 2300)]),
    items: [
      { id: 'bed', type: 'bed', wall: 'W4', offset: 900, policy: 'keep', product: true },
      { id: 'ns1', type: 'nightstand', x: 3300, y: 400, policy: 'free' }, { id: 'ns2', type: 'nightstand', x: 3300, y: 950, policy: 'free' },
      { id: 'ward', type: 'wardrobe', x: 3000, y: 3150, dims: { W: 1200 }, policy: 'free' }, { id: 'dresser', type: 'dresser', x: 3300, y: 1900, policy: 'free' },
      { id: 'mirror', type: 'mirror', wall: 'W3', offset: 300, policy: 'free' }, { id: 'rug', type: 'rug', x: 2800, y: 1000, policy: 'free' },
    ],
    brief: { text: 'Уютная спальня в тёплых тонах, чтобы у кровати с обеих сторон были тумбы', prefs: { palette: 'Тёплая' }, room: { walls: 'ai', floor: 'keep', ceiling: 'keep' } } },

  { id: 'dining', title: 'Столовая 4,5×3,6 м: товары стоят, ИИ только переставляет',
    room: rect(4500, 3600, [win('W1', 1500, 1800), arch('W4', 1200)]),
    items: [
      { id: 'table', type: 'table', x: 900, y: 2900, rot: 0, policy: 'move', product: true },
      ...[0, 1, 2, 3].map(k => ({ id: 'ch' + k, type: 'chair', x: 2300 + k * 550, y: 3200, policy: 'move', product: true })),
      { id: 'side', type: 'sideboard', x: 3300, y: 1200, policy: 'move', product: true }, { id: 'light', type: 'chandelier', x: 600, y: 600, policy: 'move', product: true },
    ],
    brief: { text: 'Стол поставить ближе к окну, стулья вокруг него, буфет у стены', prefs: { style: 'Современный' }, room: { walls: 'keep', floor: 'keep', ceiling: 'keep' } } },

  { id: 'replace', title: 'Гостиная 4,2×3,2 м: места менять нельзя — только заменить мебель и отделку',
    room: rect(4200, 3200, [win('W1', 1400), door('W3', 3000)]),
    items: [
      { id: 'sofa', type: 'sofa', wall: 'W4', offset: 500, policy: 'replace', product: true }, { id: 'tvs', type: 'tv-stand', wall: 'W2', offset: 800, policy: 'replace', product: true },
      { id: 'table', type: 'coffee-table', x: 2000, y: 1600, policy: 'replace', product: true }, { id: 'case', type: 'bookcase', wall: 'W3', offset: 300, policy: 'keep', product: true },
      { id: 'lamp', type: 'table-lamp', on: 'tvs', policy: 'replace' },
    ],
    brief: { text: 'Хочу лофт: тёмное дерево, металл, кожа. Без белой мебели.', prefs: { style: 'Лофт', palette: 'Тёмная', budget: 'Премиум' }, room: { walls: 'ai', floor: 'ai', ceiling: 'keep' } } },

  { id: 'lshape', title: 'Комната буквой Г: кабинет и зона отдыха',
    room: { poly: [[0, 0], [6000, 0], [6000, 2800], [3200, 2800], [3200, 5200], [0, 5200]], openings: [win('W1', 2200, 1800), win('W6', 1500, 1200), door('W5', 1200)] },
    items: [
      { id: 'desk', type: 'desk', x: 1500, y: 1500, policy: 'free' }, { id: 'chair', type: 'office-chair', x: 1500, y: 2400, policy: 'free' },
      { id: 'case', type: 'bookcase', x: 4500, y: 1400, policy: 'free' }, { id: 'sofa', type: 'sofa', x: 1600, y: 3800, policy: 'free' },
      { id: 'arm', type: 'armchair', x: 4800, y: 2200, policy: 'free' }, { id: 'plant', type: 'plant', x: 300, y: 300, policy: 'free' },
      { id: 'shelf', type: 'shelving', x: 2700, y: 4700, policy: 'free' },
    ],
    brief: { text: 'Рабочее место у большого окна, диван в дальней части комнаты, минимализм', prefs: { style: 'Минимализм', palette: 'Холодная', budget: 'Экономно' }, room: { walls: 'ai', floor: 'keep', ceiling: 'keep' } } },
];
