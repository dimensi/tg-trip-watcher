# tg-trip-watcher

Production-ready Telegram watcher for tracking profitable travel offers from Telegram channels.

## Features
- Telegram user authorization via gramJS with persisted session file.
- Real-time channel monitoring with reconnect loop and FloodWait handling.
- Hybrid parsing pipeline: regex first, then OpenRouter LLM fallback.
- Free-form post parsing with candidate segmentation, prose date extraction, and best-offer selection.
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
  cli/
    parsePost.ts
  filters/
    tourFilters.ts
  notifier/
    telegramNotifier.ts
  services/
    tourService.ts
  types/
    tour.ts
  index.ts
Dockerfile
docker-compose.yml
docker-compose.deploy.yml
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

## Parser debug (no Telegram)

Run the same regex → LLM pipeline as production and print a JSON trace (`route`, `regex`, optional `llm` / `llmTours`, optional `llmRaw`, `result`, **`results`** — all merged tours; several when the LLM extracts multiple offers from one post) without starting the bot:

```bash
npm run parse-post -- "short post text"
printf '%s' 'multiline
post' | npm run parse-post
```

Set `OPENROUTER_API_KEY` in `.env` when the post takes the LLM branch. Optional: `--config /path/to/config.json` (same schema as `data/config.json`).

## Docker deployment
```bash
docker compose up -d --build
```

Persistent data is stored in Docker volume `tg_watcher_data`:
- `/app/data/tours.db`
- `/app/data/telegram.session`

## GitHub Actions deploy (GHCR + VPS)
- Workflow: `.github/workflows/deploy.yml`
- Deploy compose: `docker-compose.deploy.yml`
- On each push to `main`:
  - image is built from `Dockerfile` and pushed to `ghcr.io/<owner>/<repo>:latest`
  - VPS pulls latest image and runs `docker compose up -d`

Required GitHub secrets:
- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `VPS_PORT` (optional; defaults to `22`)
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `BOT_TOKEN`
- `OPENROUTER_API_KEY`
- `TELEGRAM_PHONE_NUMBER` (optional)

Optional GitHub variables:
- `LOG_LEVEL` (default `info`)
- `MT_PROXY` (`tg://proxy?server=ip_address&port=443&secret=secret_key`)

## Telegram login flow
- For first start, set `TELEGRAM_LOGIN_CODE` in `.env` (code from Telegram SMS/app).
- After successful login, session is persisted and can be reused without code.
- If 2FA is enabled, set `TELEGRAM_PASSWORD`.

## Filtering
Configured through `data/config.json`:
- `departureCities` (exact city match against parsed departure city list)
- `arrivalCities` (case-insensitive partial match against parsed destination)
- `maxPrice`, `minNights`, `maxNights`, `dateFrom`, `dateTo`

**Nights:** optional range `minNights`–`maxNights` (inclusive). If both are set to the same value, only that night count matches. Omitted means no constraint on nights.

Bot: `/nights 5 12` (range), `/nights 7` (exactly 7 nights), `/nights off` (clear night limits).

Free-form channel posts can still match filters when they contain a usable destination, departure city, and start date, even if the post omits an explicit date range or full package details.

When regex alone is not enough, the LLM returns a **`tours` array**; each offer is merged with regex hints, filtered, and stored/notified **separately** (`offer_index` in SQLite).

You can update filters via bot commands and by editing `data/config.json` manually.

Legacy env filter variables may still be present in older setups, but the runtime source of truth is `data/config.json`.

Channel updates are applied automatically at runtime; manual fallback is available via `/reload`.

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
