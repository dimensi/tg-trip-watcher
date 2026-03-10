# grammY Bot Refactor — Design

**Goal:** Replace manual fetch-based polling loop in `src/bot/` with grammY framework, keeping all business logic intact.

**Scope:** `src/bot/index.ts` (full rewrite), `src/bot/onboarding.ts` (minor), `src/bot/commands.ts` (minor). GramJS (`telegram` package) for channel monitoring is untouched.

---

## Architecture

### Before

```
src/bot/index.ts
  - Manual fetch loop (getUpdates → offset)
  - Manual retry on network failure
  - Command dispatch via Map<string, handler>
  - setTextHandler() global mutable slot
  - isAuthorized() check inline
  - sendMessage() via raw fetch (throws on failure)
```

### After

```
src/bot/index.ts
  - grammY Bot instance (exported singleton)
  - bot.use(authMiddleware) — replaces isAuthorized()
  - bot.start() — replaces polling loop
  - sendMessage(chatId, text) → bot.api.sendMessage() wrapper
  - Text input during auth → bot.on('message:text') with auth-state flag
  - startPolling(signal) → wraps bot.start() / bot.stop()
```

---

## Components

### `src/bot/index.ts` — full rewrite

- Create `Bot` instance from grammY with `envConfig.botToken`
- Auth middleware: if `chatId` is set and sender differs → ignore (no reply)
- Export `sendMessage(chatId, text)` using `bot.api.sendMessage()`
- Export `startPolling(signal)` — calls `bot.start()`, stops on abort
- Remove: `registerCommand`, `setTextHandler`, `isAuthorized`, manual polling loop

### `src/bot/onboarding.ts` — minor changes

- `registerCommand('start', handler)` → `bot.command('start', ctx => handler(ctx.chat.id, ''))`
- `setTextHandler(handler)` → module-level flag `authInProgress: boolean` + `bot.on('message:text')` handler that routes to active auth resolver
- `sendMessage(chatId, text)` calls remain — they use the new wrapper

### `src/bot/commands.ts` — minor changes

- `registerCommand(name, handler)` → `bot.command(name, ctx => handler(ctx.chat.id, ctx.match))`
- `sendMessage(chatId, text)` calls remain unchanged
- `setupCommands()` called once at startup, registers all commands on the bot instance

---

## Data Flow

```
Telegram → grammY long-poll → authMiddleware → command router
                                                  ├── /start → onboarding.ts
                                                  ├── /help, /status, ... → commands.ts
                                                  └── free text → auth resolver (if active)
```

---

## Key Decisions

- **`chatId` stays in `config.json`** — it's a whitelist, not per-user session state
- **`sendMessage` stays as named export** — onboarding.ts needs to send messages outside of ctx (e.g. during GramJS auth callbacks)
- **No grammY sessions** — not needed; auth state is transient in-memory during auth flow only
- **Approach A (minimal)** — preserve all business logic, replace only infrastructure

---

## Files Changed

| File | Change |
|------|--------|
| `package.json` | add `grammy` |
| `src/bot/index.ts` | full rewrite |
| `src/bot/onboarding.ts` | replace registerCommand/setTextHandler |
| `src/bot/commands.ts` | replace registerCommand calls |
| `src/index.ts` | update imports if needed |
