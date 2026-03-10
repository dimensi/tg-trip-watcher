# Config & Onboarding Refactor Design

## Problem

- OpenRouter integration uses raw `fetch` instead of SDK
- Telegram login requires env variables (`TELEGRAM_LOGIN_CODE`) — awkward for first auth
- `BOT_CHAT_ID` is unclear and must be set manually
- All 30+ settings are in `.env`, including frequently changed filters

## Solution: Minimal Refactor

### 1. Configuration: env + JSON split

**Env (`.env`)** — secrets only (4 variables):
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `BOT_TOKEN`
- `OPENROUTER_API_KEY`

**JSON (`data/config.json`)** — everything else, hot-reloadable:
```json
{
  "chatId": null,
  "telegram": {
    "channels": ["@cheaptrips", "@traveldeals"],
    "sessionPath": "./data/telegram.session"
  },
  "openRouter": {
    "model": "openai/gpt-4o-mini",
    "timeoutMs": 15000,
    "maxRetries": 3,
    "maxInputChars": 4000,
    "maxCostUsd": 0.03
  },
  "filters": {
    "maxPrice": 70000,
    "departureCities": ["Perm", "Moscow"],
    "minNights": 5,
    "maxNights": 12,
    "dateFrom": "2026-01-01",
    "dateTo": "2026-12-31"
  },
  "app": {
    "logLevel": "info",
    "timezone": "UTC"
  }
}
```

- `chatId: null` on first launch — auto-filled after `/start`
- `fs.watch` on file — re-read and validate via zod schema on change
- Bot commands modify JSON and trigger the same reload
- Missing file — created with defaults

### 2. Onboarding via bot

**First launch flow:**
1. App starts. Bot works, Telegram client not yet connected
2. User sends `/start` to bot
3. Bot saves `chatId` to `config.json`, replies: "Need to authorize Telegram"
4. Bot takes phone number from env `TELEGRAM_PHONE_NUMBER` if set, or asks in chat
5. Bot sends: "Auth code sent, send it here"
6. User sends code → app authorizes, saves session
7. If 2FA — bot asks for password
8. Bot replies: "Auth successful, monitoring started"
9. Watcher starts

**Subsequent launches (session exists):**
1. App starts, finds saved session and `chatId` in config
2. Telegram client connects automatically
3. Watcher starts immediately
4. Bot sends: "Bot started, monitoring active"

**State is implicit:**
- `chatId` in config = bot knows who to message
- Session file exists = Telegram authorized
- No session + has `chatId` = need re-auth via bot

### 3. OpenRouter via OpenAI SDK

Replace raw fetch with `openai` SDK:
```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: envConfig.openRouterApiKey,
});

const response = await client.chat.completions.create({
  model: jsonConfig.openRouter.model,
  temperature: 0.1,
  response_format: { type: 'json_object' },
  messages: [
    { role: 'system', content: '...' },
    { role: 'user', content: buildPrompt(text) }
  ],
});
```

- Retry, timeout, types — all handled by SDK
- Remove manual `AbortController`, retry loop, `OpenRouterResponse`/`OpenRouterUsage` interfaces
- Cost guard remains — check `response.usage` after response
- `llmParser.ts` shrinks roughly in half

### 4. Bot commands

| Command | Action |
|---------|--------|
| `/start` | Onboarding, save chatId |
| `/help` | List all commands with descriptions |
| `/filters` | Show current filters |
| `/setprice 50000` | Set maxPrice |
| `/nights 5 12` | Set min/max nights |
| `/dates 2026-03-01 2026-09-01` | Set dateFrom/dateTo |
| `/addcity Kazan` | Add departure city |
| `/rmcity Kazan` | Remove departure city |
| `/channels` | Show channels |
| `/addchannel @deals` | Add channel |
| `/rmchannel @deals` | Remove channel |
| `/status` | Status: auth, channel count, filters |

- Each command validates input, updates in-memory config, writes `config.json`
- Bot replies with confirmation showing new value
- All commands restricted to saved `chatId` (protection from strangers)
- Manual `config.json` edits picked up by `fs.watch`, bot does not notify
- Unrecognized commands show `/help`

### 5. File structure after refactor

```
src/
├── config/
│   ├── env.ts          — load secrets from env (4 variables only)
│   └── jsonConfig.ts   — read/write/watch config.json, zod validation
├── telegram/
│   ├── client.ts       — remove env-based login, add callback for code
│   └── watcher.ts      — no changes
├── parser/
│   ├── llmParser.ts    — rewrite to openai SDK
│   └── ...             — no changes
├── bot/
│   ├── index.ts        — bot init, command registration
│   ├── commands.ts     — command handlers (/filters, /setprice, etc.)
│   └── onboarding.ts   — auth flow via chat
├── notifier/
│   └── telegramNotifier.ts — no changes
└── index.ts            — new startup order: bot → onboarding → watcher
```

**New dependencies:**
- `openai` — SDK for OpenRouter
- `zod` — JSON config validation

**Removed env variables:** ~25. Remaining: 4 (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `BOT_TOKEN`, `OPENROUTER_API_KEY`)
