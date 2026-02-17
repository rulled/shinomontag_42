# Telegram Mini App для записи на шиномонтаж

Проект реализует:
- запись пользователя на свободные слоты по 1 часу;
- отмену своей записи;
- напоминания за 24ч, 4ч и 1ч;
- уведомления о создании/отмене/переносе;
- админ-панель для управления графиком, блокировкой слотов, отменой и переносом записей.

## Стек
- `Node.js` + `Express`
- `SQLite` (`better-sqlite3`)
- Telegram bot на `grammy` (polling)
- Frontend Mini App: `HTML/CSS/JS` без фреймворков

## Основные возможности
- 1 точка обслуживания, 1 машина на слот
- язык интерфейса: русский
- настраиваемый график по дням недели
- настраиваемые ограничения:
  - минимальное время до записи (по умолчанию 2 часа)
  - горизонт записи (по умолчанию без лимита)
- ручная блокировка/разблокировка отдельных слотов админом
- у пользователя только одна активная запись

## Быстрый старт
1. Установите Node.js 20+.
2. Установите зависимости:
   ```bash
   npm install
   ```
3. Создайте `.env` на основе `.env.example`.
4. Запустите:
   ```bash
   npm start
   ```
5. Проверьте health:
   - `http://127.0.0.1:3000/api/health`

База `SQLite` создается автоматически по пути `DB_PATH`.

## Переменные окружения
- `PORT` - порт backend (по умолчанию `3000`)
- `BOT_TOKEN` - токен Telegram бота
- `APP_SECRET` - секрет подписи внутренних токенов API
- `ADMIN_IDS` - список Telegram user_id админов через запятую
- `MINI_APP_URL` - URL Mini App (`https://app.<домен>`)
- `APP_ORIGIN` - origin фронтенда (`https://app.<домен>`)
- `API_ORIGIN` - origin API (`https://api.<домен>`)
- `DB_PATH` - путь к SQLite
- `ALLOW_DEV_LOGIN` - dev-авторизация (`false` в проде)

## Как работает авторизация Mini App
- клиент отправляет `Telegram.WebApp.initData` в `POST /api/auth/telegram`
- backend проверяет подпись `initData` по `BOT_TOKEN`
- backend выдает внутренний Bearer-токен

## Деплой на Windows Server 2019 (рекомендуемый)

### 1. DNS
Убедитесь, что `A` записи:
- `app.<ваш_домен> -> xx.xx.xxx.xx`
- `api.<ваш_домен> -> xx.xx.xxx.xx`

### 2. Автодеплой одним скриптом
Добавлен скрипт: `scripts/deploy-windows.ps1`.

Ваши пути уже выставлены в нем по умолчанию:
- Caddy: `C:\caddy\caddy_windows_amd64.exe`
- приложение: `C:\bot`

Обычный запуск (manual mode, без Windows Services):
```powershell
cd C:\bot
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-windows.ps1 -AppDomain app.<ваш_домен> -ApiDomain api.<ваш_домен>
```

Что делает скрипт:
- проверяет git-обновления (`git pull --ff-only`) в `C:\bot`;
- синхронизирует файлы проекта в `C:\bot`;
- создает `.env` из `.env.example` (если нужно);
- обновляет `MINI_APP_URL`, `APP_ORIGIN`, `API_ORIGIN`;
- устанавливает npm-зависимости;
- генерирует `C:\caddy\Caddyfile`;
- по умолчанию запускает backend и Caddy как обычные процессы;
- проверяет `http://127.0.0.1:3000/api/health`.

Если хотите запускать без копирования из исходной папки (когда уже работаете прямо в `C:\bot`), добавьте флаг:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-windows.ps1 -SkipSourceSync -AppDomain app.<ваш_домен> -ApiDomain api.<ваш_домен>
```

Режим Windows Services отключен по умолчанию. Чтобы включить его, запускайте PowerShell **от имени администратора** и добавляйте флаг:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-windows.ps1 -UseServices -AppDomain app.<ваш_домен> -ApiDomain api.<ваш_домен>
```

После деплоя обязательно проверьте `.env`:
- `BOT_TOKEN=<ваш токен>`
- `ADMIN_IDS=<telegram_user_id,через,запятую>`

### 3. Ручной запуск Node (опционально)
Пример:
```powershell
cd D:\Programing_shit\botfather
copy .env.example .env
npm install
npm start
```

### 4. HTTPS и reverse proxy (Caddy)
Установите Caddy for Windows и создайте `Caddyfile`:
```caddy
app.example.com, api.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

После запуска Caddy автоматически выпустит и продлит TLS сертификаты (Let's Encrypt), если:
- DNS корректно указывает на сервер,
- порты `80` и `443` доступны извне.

### 5. Автозапуск как службы (если без скрипта)
Рекомендуется 2 службы:
- `botfather-app` (Node.js)
- `caddy`

Для Node службы удобно использовать `nssm`:
```powershell
nssm install botfather-app "C:\Program Files\nodejs\node.exe" "D:\Programing_shit\botfather\src\server.js"
nssm set botfather-app AppDirectory "D:\Programing_shit\botfather"
nssm start botfather-app
```

## Настройка Telegram
1. В `@BotFather` задайте Mini App URL: `https://app.<ваш_домен>`.
2. Заполните `BOT_TOKEN` в `.env`.
3. Добавьте Telegram user_id админов в `ADMIN_IDS`.
4. Перезапустите сервис.

## Работа с админ-панелью
Админ может:
- менять timezone/ограничения записи;
- менять недельный график работы;
- блокировать/разблокировать слоты;
- отменять и переносить записи (с уведомлением пользователя).

## Важные замечания
- Резервное копирование: регулярно копируйте файл SQLite `data/app.db`.
- Для стабильности не включайте `ALLOW_DEV_LOGIN` в продакшене.
- При смене `APP_SECRET` все активные токены мини-приложения станут недействительны.

## Полезные API
- `GET /api/health`
- `POST /api/auth/telegram`
- `GET /api/me`
- `GET /api/slots/day?date=YYYY-MM-DD`
- `POST /api/bookings`
- `DELETE /api/bookings/my`
- `GET /api/admin/settings`
- `PUT /api/admin/settings`
- `PUT /api/admin/schedule`
- `GET /api/admin/day?date=YYYY-MM-DD`
- `GET /api/admin/bookings?date=YYYY-MM-DD`
- `POST /api/admin/blocked-slots`
- `DELETE /api/admin/blocked-slots/:id`
- `POST /api/admin/bookings/:id/cancel`
- `POST /api/admin/bookings/:id/reschedule`
