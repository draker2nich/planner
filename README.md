# Планировка — редактор комнаты, каталог и админ‑панель

## Запуск

Тестовый стенд на Vercel — см. **DEPLOY.md**.

Локально нужен только Node.js 22.5+ (встроенный SQLite, `npm install` не требуется).

```bash
node server/index.js            # порт 8080
PORT=3000 node server/index.js  # другой порт
```

- Редактор: http://localhost:8080/
- Админ‑панель: http://localhost:8080/admin

При первом запуске создаётся администратор. Логин и пароль выводятся в консоль и сохраняются в `data/admin-credentials.txt`: смените пароль в админ‑панели («Пароль» внизу меню) и удалите файл. Можно задать заранее: `ADMIN_EMAIL=… ADMIN_PASSWORD=… node server/index.js`.

Каталог при первом запуске наполняется 339 демо‑товарами, чтобы редактор сразу работал. Удалить их — кнопка «Удалить демо‑товары» в админ‑панели. Запуск без демо: `SEED_DEMO=0`.

Редактор можно открыть и без сервера (`public/index.html` как файл) — тогда каталог берётся из демо‑набора.

## Структура

| Путь | Что это |
|---|---|
| `public/index.html` | Редактор (план, 3D, мебель, завершение и бриф) |
| `public/admin.html` | Админ‑панель каталога |
| `public/shared/catalog-types.js` | Общий справочник категорий и форм: редактор, админка, сервер |
| `server/index.js` | Локальный сервер: статика, `/files`, API |
| `api/index.mjs` | Функция Vercel: весь API одной функцией |
| `vercel.json` | Настройки Vercel: статика из `public/`, переадресация `/api/*` и `/admin` |
| `server/core/app.js` | Маршруты API и выбор окружения (SQLite/Neon, диск/Blob) |
| `server/core/db.js` | Схема, миграции, драйверы SQLite и Postgres (Neon) |
| `server/core/storage.js` | Хранилище файлов: локальная папка или Vercel Blob |
| `server/core/auth.js` | Пользователи, роли (admin / company / client), сессии, права |
| `server/core/catalog.js` | Товары: проверка, статусы, 3D‑модели, фото, поиск |
| `server/core/glb.js` | Проверка GLB и габарита модели |
| `data/` | Локальная база и файлы (создаётся автоматически, в git не хранится) |

## 3D‑модели товаров

- Формат GLB (glTF 2.0), единицы — метры, ось Y вверх.
- Перед предмета — по +Z. В Blender: перед по −Y, экспорт с галочкой «+Y Up».
- До 50 МБ, рекомендуется до 150 000 треугольников. Сжатие Draco и meshopt пока не поддерживается.
- Габарит модели сверяется с размерами товара (допуск 2 %). При расхождении модель сохраняется, но товар нельзя опубликовать, пока размеры не совпадут. Кнопка «Взять размеры из модели» переносит габарит в размеры товара.
- В 3D редактора модель вписывается в габарит предмета и ставится на пол.

## API (кратко)

| Метод | Путь | Доступ |
|---|---|---|
| POST | `/api/auth/login` · `/api/auth/logout` · `/api/auth/password` | все |
| GET | `/api/catalog/types` · `/api/catalog/products` | публично (только опубликованные товары) |
| GET/POST | `/api/admin/products` | admin |
| GET/PATCH/DELETE | `/api/admin/products/:id` | admin |
| POST | `/api/admin/products/:id/publish` · `unpublish` · `archive` · `reject` | admin |
| PUT/DELETE | `/api/admin/products/:id/model` (тело — файл GLB) | admin |
| POST | `/api/admin/blob-upload` · `/api/admin/products/:id/model/commit` · `…/images/commit` | admin; загрузка через Vercel Blob |
| GET | `/api/health` · `/api/config` | публично; режим БД и хранилища |
| POST | `/api/admin/products/:id/model/fit-dims` | admin |
| POST/DELETE | `/api/admin/products/:id/images[/:img]` (тело — файл) | admin |
| POST | `/api/admin/products/:id/model/generate` | заложено, отвечает 501 |
| POST | `/api/auth/register` · GET `/api/company/products` | заложено, отвечают 501 |

Ошибки приходят как `{ "error": { "code", "message", "details" } }`.
