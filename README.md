# JumysAI Telegram bot service

Отдельный сервис Telegram-бота (Node + grammY), который **подключён к текущему проекту** через Convex HTTP:

- базовый URL: `{CONVEX_SITE_URL}/v1/bot`
- авторизация на каждом запросе: `x-bot-secret: {BOT_SHARED_SECRET}`

Бот работает в режиме **long polling** (процесс должен быть always-on).

## Env

Сервис читает переменные окружения из:

1) `services/telegram-bot/.env.local`
2) `services/telegram-bot/.env`
3) корневого `.env.local`
4) корневого `.env`

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | токен от `@BotFather` |
| `CONVEX_SITE_URL` | Convex **site url** (`*.convex.site`), не `*.convex.cloud` |
| `BOT_SHARED_SECRET` | общий секрет с Convex (`BOT_SHARED_SECRET` в env деплоя Convex) |

Важно: Convex деплой тоже должен иметь `TELEGRAM_BOT_TOKEN`, чтобы сервер мог отправлять Telegram-уведомления.

## Local run

```bash
cd services/telegram-bot
npm ci
npm run dev
```

## Build + start

```bash
cd services/telegram-bot
npm ci
npm run build
npm start
```

## Deploy

Подходит любой хостинг, который держит процесс постоянно (VPS + systemd/pm2, Fly.io, Render worker, и т.п.).

