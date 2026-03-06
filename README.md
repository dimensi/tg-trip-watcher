# tg-trip-watcher

Production-ready Telegram watcher for tracking profitable travel offers from Telegram channels.

## Features
- Telegram user authorization via gramJS with persisted session file.
- Real-time channel monitoring with reconnect loop and FloodWait handling.
- Hybrid parsing pipeline: regex first, then OpenRouter LLM fallback.
- SQLite storage with duplicate protection and notification history.
- Flexible .env filters (price, departure city, dates, nights).
- Telegram Bot API notifications for matched deals.
- Structured logging via pino.
- Dockerized deployment with persistent volume and healthcheck.

## Tech stack
- Node.js 20+
- TypeScript
- gramJS
- better-sqlite3
- OpenRouter API
- Docker + docker-compose

## Project structure
```
/src
  config.ts
  db.ts
  telegram/
    client.ts
    watcher.ts
  parser/
    regexParser.ts
    llmParser.ts
    index.ts
  filters/
    tourFilters.ts
  notifier/
    telegramNotifier.ts
  services/
    tourService.ts
  types/
    tour.ts
  index.ts
/docker
  Dockerfile
  docker-compose.yml
```

## Quick start (local)
1. Copy environment:
   ```bash
   cp .env.example .env
   ```
2. Fill required values in `.env`.
3. Install and run:
   ```bash
   npm install
   npm run dev
   ```

## Docker deployment
```bash
docker compose -f docker/docker-compose.yml up -d --build
```

Persistent data is stored in Docker volume `tg_watcher_data`:
- `/app/data/tours.db`
- `/app/data/telegram.session`

## Telegram login flow
- For first start, set `TELEGRAM_LOGIN_CODE` in `.env` (code from Telegram SMS/app).
- After successful login, session is persisted and can be reused without code.
- If 2FA is enabled, set `TELEGRAM_PASSWORD`.

## Filtering
Configured through `.env`:
- `MAX_PRICE`
- `DEPARTURE_CITIES`
- `MIN_NIGHTS`
- `MAX_NIGHTS`
- `DATE_FROM`
- `DATE_TO`

## OpenRouter notes
- Set `OPENROUTER_API_KEY` and model in `OPENROUTER_MODEL`.
- Timeout/retries are configurable.
- Request usage and token/cost metadata are logged.
- Hard cost guard is enforced by `OPENROUTER_MAX_COST_USD`.

## Production recommendations
- Use dedicated Telegram account for monitoring.
- Restrict outgoing network in VPS firewall.
- Route logs into centralized collector.
- Backup `/app/data/tours.db` regularly.

## Commands
- Development: `npm run dev`
- Build: `npm run build`
- Start built app: `npm run start`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
