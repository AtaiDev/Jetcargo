# Jetcargo · для разработчиков

Подробности, которые не поместились в [README](../README.md): что умеет каждый раздел, как считаются деньги,
запуск, публикация, облако, безопасность, структура кода и API.

## Возможности

| Раздел | Что умеет |
|---|---|
| **Обзор** | сумма заказов, оплачено, долги, выкуп и прибыль за период; товары по этапам (заказано → на складе → выдано); топ должников; графики |
| **Новый заказ** | клиент (поиск или новый, телефон с автоподстановкой `+996`) и несколько товаров за раз; статус и оплата (нет / полностью / частично) |
| **Приём товара** | сканер штрихкода с режимами **В партию** · **Без партии** · **Поиск товара** (только просмотр); звуки на каждый результат, подсказки похожих кодов при опечатке, итоги за сегодня |
| **Выдача** | поиск клиента по телефону, имени или коду товара; выбор товаров со склада, приём оплаты, выдача с долгом только осознанно; история выдач по периодам |
| **Заказы** | все товары с группировкой по клиенту и дате, фильтры по статусу, оплате и датам, массовая смена статуса и оплаты |
| **Склад** | что ожидается, что на складе, что готово к выдаче; журнал сканирований |
| **Партии** | прибыль партии: доходы (вес клиентам + наценка на товары) минус расходы (выкуп веса + доставка); суммы в сомах или долларах по курсу |
| **Клиенты** | поиск в любом формате телефона, сортировка по долгу/сумме/дате, карточка клиента со всеми товарами и оплатами |
| **Финансы** | поступления, должники, помесячная таблица и график |
| **Импорт Excel** | превью, сопоставление колонок, проверка дублей, отмена импорта |
| **Сотрудники · Журнал · Настройки** | роли `admin` / `staff`, журнал всех действий, курсы валют, тема |

Карточка товара открывается кликом по любой строке: статус в один клик, редактирование, оплаты, история статусов
и сканирований. Глобальный поиск — `Ctrl+K`.

## Как считаются деньги

| Понятие | Формула |
|---|---|
| **Сумма** | цена, которую называете клиенту (за всё количество); от неё считаются оплата и долг |
| **Реальная цена** | за сколько товар выкуплен на маркетплейсе |
| **Прибыль товара** | Сумма − Реальная цена (если реальная цена не указана — не считается, это всегда видно) |
| **Долг** | Сумма − оплачено; выданный товар считается оплаченным |
| **Прибыль партии** | ③ вес клиентам + ④ наценка на товары − ① выкуп веса − ② доставка |

## Запуск

Нужен **Node.js 24** (используется встроенный `node:sqlite`).

```bash
# 1. зависимости
cd server && npm install && cd ..
cd web-admin && npm install && cd ..

# 2. настройки backend
cp server/.env.example server/.env
#    заполните JWT_SECRET, ADMIN_LOGIN, ADMIN_PASSWORD

# 3. backend + админка одной командой (Ctrl+C останавливает оба)
npm run dev
```

- Админка: <http://localhost:5173/admin/>
- API: <http://127.0.0.1:8787/api/v1>

Первый администратор создаётся при первом запуске из `ADMIN_LOGIN` / `ADMIN_PASSWORD`; дальше пароль хранится
в базе только в виде хэша.

## Публикация (GitHub Pages)

Frontend автоматически публикуется на **<https://ataidev.github.io/Jetcargo/>** при каждом push в `main`
(`.github/workflows/pages.yml`: `npm ci` → `npm run build` с `VITE_BASE=/Jetcargo/` → содержимое `web-admin/dist`).

GitHub Pages отдаёт только статический frontend. Данные он берёт у backend по адресу из переменной репозитория
`VITE_API_URL` (Settings → Secrets and variables → Actions → Variables); без неё — `http://127.0.0.1:8787/api/v1`,
то есть работает только на компьютере, где запущен backend.

### Backend в облаке (бесплатно)

```
GitHub Pages (админка) ──HTTPS──> Render, free (server/, Docker) ──Litestream──> Backblaze B2 (копия базы)
```

- **Render** запускает `server/` из `server/Dockerfile` (`render.yaml` — Blueprint). Облачный режим включается сам:
  сервер пускает только свой домен (`RENDER_EXTERNAL_HOSTNAME`) и только запросы из `CORS_ORIGINS`.
- **Litestream** ежесекундно копирует базу в **Backblaze B2** и восстанавливает её при каждом старте — диск
  бесплатного Render не сохраняется, а данные не теряются.
- **«Будильник»** (`.github/workflows/keepalive.yml`) раз в 10 минут обращается к `API_HEALTH_URL`, чтобы бесплатный
  сервер не засыпал.

Первый запуск:

1. Backblaze B2: создать приватный bucket и Application Key с доступом к нему.
2. Загрузить текущую локальную базу как первоначальную:
   `cd server && B2_KEY_ID=… B2_APP_KEY=… B2_BUCKET=… node scripts/seed-b2.mjs` (выведет `B2_ENDPOINT`).
3. Render → New → Blueprint → этот репозиторий; ввести `B2_BUCKET`, `B2_ENDPOINT`, `B2_KEY_ID`, `B2_APP_KEY`.
4. В GitHub (Settings → Secrets and variables → Actions → Variables) задать
   `VITE_API_URL = https://<сервис>.onrender.com/api/v1` и `API_HEALTH_URL = https://<сервис>.onrender.com/health`,
   затем перезапустить «Deploy to GitHub Pages».

## Технологии

- **Админка** (`web-admin/`) — React 18, Vite, TypeScript, React Router, Recharts; собственная дизайн-система
  без UI-библиотек (светлая и тёмная тема, адаптив под телефон).
- **Backend** (`server/`) — Node.js 24, Express 5, SQLite (`node:sqlite`), JWT, scrypt, ExcelJS.

## Безопасность и данные

- Backend слушает **только `127.0.0.1`**, отклоняет чужой `Host`, CORS — только для адреса админки.
- JWT: access 60 минут, refresh 7 дней; пароли — scrypt; ограничение неудачных входов.
- Роли: `admin` — всё; `staff` — без импорта, сотрудников, журнала, удаления и отмены оплат.
- Удаление только **мягкое**: запись скрывается, но остаётся в базе с историей.
- Сканирования и история статусов только дописываются.
- Схема меняется миграциями, которые только добавляют (`server/src/db.ts`, версия в `PRAGMA user_version`).
- База (`server/data/`) и `.env` в git **не попадают**. Резервная копия — скопировать `server/data/`
  при остановленном сервере.

## Структура

```
server/src/
  config.ts · db.ts (миграции) · domain.ts (общая логика) · security.ts
  routes/        auth · customers · items · orders · warehouse · batches · dashboard · imports · misc
web-admin/src/
  api/           client (JWT, refresh) · domain (весь контракт API и типы)
  screens/       overview · NewOrder · Receive · Issue · Orders · Warehouse · Batches · Customers · Finance · Import …
  components/    ItemModal · ItemTable · BulkBar · Select · DatePicker · PhoneInput · CustomerSearch · GlobalSearch · cargo
  design/        дизайн-система: стили, иконки, таблицы, UI, графики, логотип
  lib/           cargo (форматы, расчёты) · events · sound (звуки сканера)
design/          макет панели и логотип
scripts/dev.mjs  запуск backend + админки
```

## API

Экраны обращаются к сети только через `web-admin/src/api/domain.ts`. Ошибки приходят как `{ "detail": "текст" }`.

```
auth       POST /auth/login · POST /auth/refresh · GET /auth/me
users      GET/POST /users · PATCH /users/:id
customers  GET/POST /customers · GET/PATCH/DELETE /customers/:id · POST /customers/:id/payments
orders     POST /orders
items      GET/POST /items · GET/PATCH/DELETE /items/:id · POST /items/:id/status · POST /items/:id/payments
           POST /items-bulk/status · POST /items-bulk/pay · DELETE /payments/:id
warehouse  POST /scan · GET /scan/lookup · GET /scans · GET /issue/lookup · GET/POST /issues
batches    GET/POST /batches · GET/PATCH/DELETE /batches/:id · POST /batches/:id/items[/remove]
dashboard  GET /dashboard · GET /finance · GET /dashboard/widgets · PATCH /dashboard/widgets/:id
import     POST /import/preview · POST /import/commit · GET /imports · POST /imports/:id/undo
misc       GET /search · GET/PATCH /settings · GET /audit
```

## Проверки

```bash
cd web-admin && npm run lint && npm run build   # типы + сборка админки
cd server && npm run lint                        # типы backend
```

То же запускает GitHub Actions на каждый push (`.github/workflows/ci.yml`).

