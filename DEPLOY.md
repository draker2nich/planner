# Деплой на Vercel (тестовый стенд)

Что получится: редактор на `https://<проект>.vercel.app/`, админ‑панель на `/admin`, API на `/api/*`.
На Vercel нет постоянного диска, поэтому данные лежат в двух сервисах Vercel Storage:

| Что | Где на Vercel | Где локально |
|---|---|---|
| База (товары, пользователи, журнал) | Neon Postgres (Vercel Marketplace) | SQLite, `data/planner.sqlite` |
| Файлы (3D‑модели, фото) | Vercel Blob, доступ **Public** | папка `data/uploads` |

Код один и тот же: сервер сам выбирает режим по переменным окружения `DATABASE_URL` и `BLOB_READ_WRITE_TOKEN`.

## 1. Код в GitHub

```bash
cd planner            # папка проекта (с package.json и vercel.json)
git init
git add .
git commit -m "Планировка: редактор, каталог, админ‑панель"
git branch -M main
git remote add origin https://github.com/<вы>/planner.git   # создайте пустой репозиторий на github.com
git push -u origin main
```

Папка `data/` в git не попадает (`.gitignore`) — там локальная база и файлы.

## 2. Проект на Vercel

1. vercel.com → **Add New… → Project** → **Import** репозитория `planner`.
2. **Framework Preset: Other**. Root Directory — корень. Build/Output менять не нужно: всё задано в `vercel.json`.
3. **Deploy**. Первый деплой соберётся, но API ответит «не подключена база» — это нормально, подключаем дальше.
4. **Settings → General → Node.js Version: 22.x** (или новее).

## 3. База данных — Neon

1. Проект → вкладка **Storage** → **Create Database** → **Neon** (Serverless Postgres) → **Continue**.
2. Регион — ближайший к региону функций (по умолчанию функции в Вашингтоне, `iad1` → выбирайте US East).
3. Подключите базу к проекту для окружений **Production** и **Preview**.
4. В **Settings → Environment Variables** появится `DATABASE_URL`. Таблицы создавать не нужно — сервер создаст их сам при первом запросе.

## 4. Файлы — Vercel Blob

1. **Storage → Create Database → Blob**.
2. Доступ — **Public** (модели и фото должен читать редактор без входа).
3. Подключите к проекту (Production и Preview).
4. Проверьте, что в **Environment Variables** есть `BLOB_READ_WRITE_TOKEN` — он нужен для загрузки файлов из браузера.

## 5. Администратор и настройки

**Settings → Environment Variables** → добавьте (Production и Preview):

| Переменная | Значение |
|---|---|
| `ADMIN_EMAIL` | почта администратора, например `you@company.com` |
| `ADMIN_PASSWORD` | надёжный пароль, от 8 символов |
| `SEED_DEMO` | `0`, если демо‑товары не нужны (по умолчанию их 339, удаляются кнопкой в админке) |

Администратор создаётся один раз — при первом запросе к пустой базе. Потом пароль меняется в админ‑панели («Пароль» внизу меню), переменная больше не читается.

## 6. Redeploy

Переменные применяются только к новым деплоям: **Deployments → ⋯ у последнего → Redeploy**.

## 7. Проверка

1. Откройте `https://<проект>.vercel.app/api/health`. Ожидается:
   `{"ok":true,"db":"postgres","storage":"blob","setup":null}`.
   Первый запрос может идти 5–15 секунд: создаются таблицы и загружаются демо‑товары.
2. `https://<проект>.vercel.app/admin` → вход с `ADMIN_EMAIL` / `ADMIN_PASSWORD` → смените пароль.
3. Добавьте товар, загрузите GLB и фото, опубликуйте.
4. Откройте редактор `https://<проект>.vercel.app/`, поставьте этот товар в комнату и зайдите в 3D — модель должна быть на месте.

## Обновления

`git push` в `main` → Vercel сам собирает и выкатывает новую версию. Пуш в другую ветку создаёт Preview‑адрес.
Учтите: Preview и Production по умолчанию работают с одной базой Neon и одним Blob store — тестовые правки в Preview видны и в Production. Если это мешает, в настройках интеграции Neon можно включить отдельную ветку базы для Preview.

## Если что‑то не так

| Симптом | Причина и что сделать |
|---|---|
| `/api/health` → 503 «Не подключена база данных» | Нет `DATABASE_URL`: шаг 3, затем Redeploy |
| 503 «Не подключено хранилище файлов» | Нет `BLOB_READ_WRITE_TOKEN`: шаг 4, затем Redeploy |
| Вход → «Администратор не создан» | Нет `ADMIN_EMAIL` / `ADMIN_PASSWORD`: шаг 5, затем Redeploy |
| `/api/...` → 404 от Vercel | Не применился `vercel.json`: он должен лежать в корне репозитория, рядом с `package.json` |
| Загрузка модели: «Не удалось загрузить модуль загрузки файлов» | Браузер не смог скачать `@vercel/blob/client` с esm.sh / jsdelivr (блокировщик, корпоративная сеть). Откройте админку из другой сети или без блокировщика |
| Загрузка модели: «Загрузка в хранилище не удалась» | Blob store создан как Private или не подключён к проекту. Нужен **Public** |
| Модель загрузилась, но в 3D редактора — коробка | Откройте консоль браузера: при ошибке CORS или загрузки GLB редактор показывает типовой предмет. Проверьте, что товар опубликован и у модели статус «3D готова» |
| Забыли пароль администратора | Neon → SQL Editor: `DELETE FROM sessions; DELETE FROM users WHERE role='admin';` → сервер создаст администратора из `ADMIN_EMAIL` / `ADMIN_PASSWORD` при следующем холодном старте (или после Redeploy) |
| Логи сервера | Проект → **Logs** (или Deployments → деплой → Functions) |

## Локальный запуск с ресурсами Vercel (необязательно)

```bash
npm install
npx vercel link          # связать папку с проектом
npx vercel env pull .env.local
node --env-file=.env.local server/index.js
```

Так локальный сервер работает с той же базой Neon и тем же Blob, что и стенд. Без `.env.local` он работает на SQLite и локальной папке — ничего ставить не нужно.
