# grammY Bot Refactor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the hand-rolled fetch polling loop and command dispatch in `src/bot/` with the grammY framework, keeping all business logic intact.

**Architecture:** grammY `Bot` singleton is created in `src/bot/index.ts` and imported by `commands.ts` and `onboarding.ts`. Auth middleware replaces `isAuthorized()`. `bot.command()` replaces `registerCommand()`. `bot.on('message:text')` + a module-level resolver variable replaces `setTextHandler()`. `sendMessage` and `startPolling` keep their existing signatures so `src/index.ts` needs no changes.

**Tech Stack:** TypeScript, grammy, pino, telegram (GramJS — untouched)

---

### Task 1: Install grammy

**Files:**
- Modify: `package.json`

**Step 1: Install**

Run: `npm install grammy`

**Step 2: Verify**

Run: `npm ls grammy`
Expected: grammy listed without errors

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add grammy dependency"
```

---

### Task 2: Rewrite src/bot/index.ts

**Files:**
- Modify: `src/bot/index.ts`

**Step 1: Replace entire file**

```typescript
import { Bot } from 'grammy';
import pino from 'pino';
import { envConfig, getJsonConfig } from '../config';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'bot' });

export const bot = new Bot(envConfig.botToken);

// Authorization middleware — silently drops messages from unauthorized chats
bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  const cfg = getJsonConfig();
  if (cfg.chatId !== null && cfg.chatId !== chatId) {
    logger.warn({ chatId }, 'Unauthorized message ignored');
    return;
  }
  await next();
});

bot.catch((err) => {
  logger.error({ err: err.error }, 'Bot error');
});

export const sendMessage = async (chatId: number, text: string): Promise<void> => {
  await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
};

export const startPolling = async (signal: AbortSignal): Promise<void> => {
  signal.addEventListener('abort', () => {
    bot.stop().catch((err: unknown) => logger.error({ err }, 'Error stopping bot'));
  });
  logger.info('Bot polling started');
  await bot.start();
};
```

**Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: Errors only in `commands.ts` and `onboarding.ts` (they still import `registerCommand`/`setTextHandler` which no longer exist) — that's expected at this stage.

**Step 3: Commit**

```bash
git add src/bot/index.ts
git commit -m "feat: replace manual polling loop with grammy Bot"
```

---

### Task 3: Update src/bot/commands.ts

**Files:**
- Modify: `src/bot/commands.ts`

**Step 1: Replace entire file**

Replace `registerCommand(name, handler)` calls with `bot.command(name, ctx => ...)`. The handler signature changes from `(chatId, args)` to reading `ctx.chat.id` and `ctx.match`. Business logic inside each handler is identical — only the wrapper changes.

```typescript
import { getJsonConfig, updateJsonConfig } from '../config';
import { bot, sendMessage } from './index';

const HELP_TEXT = `<b>Доступные команды:</b>

/help — список команд
/status — статус бота
/filters — текущие фильтры
/setprice 50000 — установить макс. цену
/nights 5 12 — мин/макс ночей
/dates 2026-03-01 2026-09-01 — диапазон дат
/addcity Казань — добавить город вылета
/rmcity Казань — убрать город вылета
/channels — список каналов
/addchannel @deals — добавить канал
/rmchannel @deals — убрать канал`;

export const setupCommands = (getStatus: () => { authorized: boolean; watching: boolean }): void => {
  bot.command('help', async (ctx) => {
    await sendMessage(ctx.chat.id, HELP_TEXT);
  });

  bot.command('start', async (ctx) => {
    // /start is handled by onboarding — this is a fallback for when onboarding is already done
    await sendMessage(ctx.chat.id, 'Бот уже запущен. Используйте /help для списка команд.');
  });

  bot.command('status', async (ctx) => {
    const chatId = ctx.chat.id;
    const cfg = getJsonConfig();
    const status = getStatus();
    const lines = [
      `<b>Статус:</b>`,
      `Telegram: ${status.authorized ? '✅ подключен' : '❌ не подключен'}`,
      `Мониторинг: ${status.watching ? '✅ активен' : '❌ не активен'}`,
      `Каналы: ${cfg.telegram.channels.length > 0 ? cfg.telegram.channels.join(', ') : 'не указаны'}`,
      `Модель: ${cfg.openRouter.model}`,
    ];
    await sendMessage(chatId, lines.join('\n'));
  });

  bot.command('filters', async (ctx) => {
    const chatId = ctx.chat.id;
    const f = getJsonConfig().filters;
    const lines = [
      '<b>Фильтры:</b>',
      `Макс. цена: ${f.maxPrice ?? 'не задана'}`,
      `Города: ${f.departureCities.length > 0 ? f.departureCities.join(', ') : 'любые'}`,
      `Ночей: ${f.minNights ?? '—'} — ${f.maxNights ?? '—'}`,
      `Даты: ${f.dateFrom ?? '—'} — ${f.dateTo ?? '—'}`,
    ];
    await sendMessage(chatId, lines.join('\n'));
  });

  bot.command('setprice', async (ctx) => {
    const chatId = ctx.chat.id;
    const args = ctx.match ?? '';
    const price = Number(args);
    if (!args || Number.isNaN(price) || price <= 0) {
      await sendMessage(chatId, 'Использование: /setprice 50000');
      return;
    }
    updateJsonConfig((d) => { d.filters.maxPrice = price; });
    await sendMessage(chatId, `Макс. цена: ${price} ₽`);
  });

  bot.command('nights', async (ctx) => {
    const chatId = ctx.chat.id;
    const parts = (ctx.match ?? '').split(/\s+/);
    if (parts.length !== 2) {
      await sendMessage(chatId, 'Использование: /nights 5 12');
      return;
    }
    const [min, max] = parts.map(Number);
    if (Number.isNaN(min) || Number.isNaN(max) || min < 0 || max < min) {
      await sendMessage(chatId, 'Некорректные значения. Пример: /nights 5 12');
      return;
    }
    updateJsonConfig((d) => { d.filters.minNights = min; d.filters.maxNights = max; });
    await sendMessage(chatId, `Ночей: ${min} — ${max}`);
  });

  bot.command('dates', async (ctx) => {
    const chatId = ctx.chat.id;
    const parts = (ctx.match ?? '').split(/\s+/);
    if (parts.length !== 2) {
      await sendMessage(chatId, 'Использование: /dates 2026-03-01 2026-09-01');
      return;
    }
    const [from, to] = parts;
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(from) || !dateRegex.test(to)) {
      await sendMessage(chatId, 'Формат дат: YYYY-MM-DD. Пример: /dates 2026-03-01 2026-09-01');
      return;
    }
    if (from > to) {
      await sendMessage(chatId, 'Дата начала должна быть раньше даты конца.');
      return;
    }
    updateJsonConfig((d) => { d.filters.dateFrom = from; d.filters.dateTo = to; });
    await sendMessage(chatId, `Даты: ${from} — ${to}`);
  });

  bot.command('addcity', async (ctx) => {
    const chatId = ctx.chat.id;
    const args = ctx.match ?? '';
    if (!args) {
      await sendMessage(chatId, 'Использование: /addcity Казань');
      return;
    }
    const cfg = getJsonConfig();
    if (cfg.filters.departureCities.includes(args)) {
      await sendMessage(chatId, `${args} уже в списке`);
      return;
    }
    updateJsonConfig((d) => { d.filters.departureCities.push(args); });
    await sendMessage(chatId, `Добавлен: ${args}\nГорода: ${getJsonConfig().filters.departureCities.join(', ')}`);
  });

  bot.command('rmcity', async (ctx) => {
    const chatId = ctx.chat.id;
    const args = ctx.match ?? '';
    if (!args) {
      await sendMessage(chatId, 'Использование: /rmcity Казань');
      return;
    }
    const cfg = getJsonConfig();
    if (!cfg.filters.departureCities.includes(args)) {
      await sendMessage(chatId, `${args} не найден в списке`);
      return;
    }
    updateJsonConfig((d) => {
      d.filters.departureCities = d.filters.departureCities.filter((c) => c !== args);
    });
    const cities = getJsonConfig().filters.departureCities;
    await sendMessage(chatId, `Удалён: ${args}\nГорода: ${cities.length > 0 ? cities.join(', ') : 'любые'}`);
  });

  bot.command('channels', async (ctx) => {
    const chatId = ctx.chat.id;
    const channels = getJsonConfig().telegram.channels;
    if (channels.length === 0) {
      await sendMessage(chatId, 'Каналы не указаны. Добавьте: /addchannel @channel');
      return;
    }
    await sendMessage(chatId, `<b>Каналы:</b>\n${channels.join('\n')}`);
  });

  bot.command('addchannel', async (ctx) => {
    const chatId = ctx.chat.id;
    const args = ctx.match ?? '';
    if (!args) {
      await sendMessage(chatId, 'Использование: /addchannel @channel');
      return;
    }
    const cfg = getJsonConfig();
    if (cfg.telegram.channels.includes(args)) {
      await sendMessage(chatId, `${args} уже в списке`);
      return;
    }
    updateJsonConfig((d) => { d.telegram.channels.push(args); });
    await sendMessage(chatId, `Добавлен: ${args}\n⚠️ Перезапустите бот для применения изменений каналов.`);
  });

  bot.command('rmchannel', async (ctx) => {
    const chatId = ctx.chat.id;
    const args = ctx.match ?? '';
    if (!args) {
      await sendMessage(chatId, 'Использование: /rmchannel @channel');
      return;
    }
    const cfg = getJsonConfig();
    if (!cfg.telegram.channels.includes(args)) {
      await sendMessage(chatId, `${args} не найден`);
      return;
    }
    updateJsonConfig((d) => {
      d.telegram.channels = d.telegram.channels.filter((c) => c !== args);
    });
    await sendMessage(chatId, `Удалён: ${args}\n⚠️ Перезапустите бот для применения изменений каналов.`);
  });
};
```

Note: A stub `/start` command is registered here so grammY routes it properly. The real `/start` handler in `onboarding.ts` (Task 4) must be registered BEFORE `setupCommands()` is called in `index.ts` — grammY runs handlers in registration order, so the first matching handler wins.

**Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: Error only in `onboarding.ts` — that's expected.

**Step 3: Commit**

```bash
git add src/bot/commands.ts
git commit -m "feat: migrate commands to grammy bot.command()"
```

---

### Task 4: Update src/bot/onboarding.ts

**Files:**
- Modify: `src/bot/onboarding.ts`

**Step 1: Replace entire file**

Key changes:
- Import `bot` instead of `registerCommand`/`setTextHandler`
- Module-level `authTextResolver` variable replaces `setTextHandler`
- `bot.command('start', ...)` replaces `registerCommand('start', ...)`
- `bot.on('message:text', ...)` registered once — routes to active resolver
- `finally { authTextResolver = null }` replaces `setTextHandler(null)`

```typescript
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { envConfig, getJsonConfig, updateJsonConfig } from '../config';
import { bot, sendMessage } from './index';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'onboarding' });

const AUTH_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

type OnAuthorized = (client: TelegramClient) => void;

// Active resolver during auth flow — null when no auth in progress
let authTextResolver: ((text: string) => void) | null = null;

export const setupOnboarding = (onAuthorized: OnAuthorized): void => {
  bot.command('start', async (ctx) => {
    const chatId = ctx.chat.id;
    const existing = getJsonConfig().chatId;

    if (existing === null) {
      updateJsonConfig((draft) => { draft.chatId = chatId; });
    } else if (existing !== chatId) {
      logger.warn({ chatId }, 'Unauthorized /start attempt ignored — chatId already set');
      return;
    }

    const cfg = getJsonConfig();
    const sessionPath = cfg.telegram.sessionPath;

    if (fs.existsSync(sessionPath)) {
      const sessionStr = fs.readFileSync(sessionPath, 'utf8');
      if (sessionStr) {
        await sendMessage(chatId, 'Сессия найдена. Подключаюсь к Telegram...');
        try {
          const client = await connectWithSession(sessionStr);
          onAuthorized(client);
          await sendMessage(chatId, '✅ Подключено! Мониторинг запущен.');
          return;
        } catch {
          await sendMessage(chatId, 'Сессия устарела. Нужна повторная авторизация.');
        }
      }
    }

    if (!process.env.TELEGRAM_PHONE_NUMBER) {
      await sendMessage(chatId, '❌ Переменная TELEGRAM_PHONE_NUMBER не задана. Добавьте её в .env и перезапустите бот.');
      return;
    }

    await sendMessage(chatId, 'Начинаю авторизацию в Telegram...');
    await startAuthFlow(chatId, onAuthorized);
  });

  // Routes free-text messages to auth flow resolver when active
  bot.on('message:text', async (ctx) => {
    if (authTextResolver) {
      authTextResolver(ctx.message.text);
      authTextResolver = null;
    }
  });
};

const connectWithSession = async (sessionStr: string): Promise<TelegramClient> => {
  const client = new TelegramClient(
    new StringSession(sessionStr),
    envConfig.telegramApiId,
    envConfig.telegramApiHash,
    { connectionRetries: 10, useWSS: true }
  );
  await client.connect();
  if (!(await client.isUserAuthorized())) {
    throw new Error('Session is not authorized');
  }
  return client;
};

const startAuthFlow = async (chatId: number, onAuthorized: OnAuthorized): Promise<void> => {
  const cfg = getJsonConfig();
  const phoneNumber = process.env.TELEGRAM_PHONE_NUMBER!;

  const client = new TelegramClient(
    new StringSession(''),
    envConfig.telegramApiId,
    envConfig.telegramApiHash,
    { connectionRetries: 10, useWSS: true }
  );

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Auth flow timed out after 10 minutes')), AUTH_TIMEOUT_MS)
  );

  try {
    await Promise.race([
      client.start({
        phoneNumber: async () => phoneNumber,
        phoneCode: async () => {
          await sendMessage(chatId, 'Введите код авторизации из Telegram:');
          return new Promise<string>((resolve) => {
            authTextResolver = resolve;
          });
        },
        password: async () => {
          await sendMessage(chatId, 'Введите пароль 2FA:');
          return new Promise<string>((resolve) => {
            authTextResolver = resolve;
          });
        },
        onError: (err) => logger.error({ err }, 'Auth error'),
      }),
      timeout,
    ]);

    const sessionStr = String(client.session.save());
    const sessionPath = cfg.telegram.sessionPath;
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, sessionStr, 'utf8');

    onAuthorized(client);
    await sendMessage(chatId, '✅ Авторизация успешна! Мониторинг запущен.');
  } catch (error) {
    logger.error({ err: error }, 'Auth flow failed');
    await sendMessage(chatId, `❌ Ошибка авторизации: ${error instanceof Error ? error.message : 'unknown'}`);
  } finally {
    authTextResolver = null;
  }
};

export const tryAutoConnect = async (): Promise<TelegramClient | null> => {
  const cfg = getJsonConfig();
  const sessionPath = cfg.telegram.sessionPath;

  if (!fs.existsSync(sessionPath)) return null;

  const sessionStr = fs.readFileSync(sessionPath, 'utf8');
  if (!sessionStr) return null;

  try {
    return await connectWithSession(sessionStr);
  } catch (error) {
    logger.warn({ err: error }, 'Auto-connect failed, waiting for /start');
    return null;
  }
};
```

**Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/bot/onboarding.ts
git commit -m "feat: migrate onboarding to grammy bot.command() and bot.on()"
```

---

### Task 5: Update src/index.ts — fix handler registration order

**Files:**
- Modify: `src/index.ts`

**Step 1: Move setupOnboarding before setupCommands**

grammY processes handlers in registration order. The `/start` command registered in `setupOnboarding` must come before the stub `/start` in `setupCommands`, otherwise `setupCommands`'s stub runs first.

Change the order so `setupOnboarding` is called before `setupCommands`:

```typescript
import pino from 'pino';
import { initJsonConfig, getJsonConfig, watchConfigFile } from './config';
import { TourDatabase } from './db';
import { TelegramNotifier } from './notifier/telegramNotifier';
import { TourService } from './services/tourService';
import { TelegramWatcher } from './telegram/watcher';
import { startPolling, sendMessage } from './bot';
import { setupOnboarding, tryAutoConnect } from './bot/onboarding';
import { setupCommands } from './bot/commands';
import { TelegramClient } from 'telegram';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const bootstrap = async (): Promise<void> => {
  initJsonConfig();
  watchConfigFile();

  const db = new TourDatabase(process.env.SQLITE_PATH ?? './data/tours.db');
  const notifier = new TelegramNotifier();
  const service = new TourService(db, notifier);

  let telegramClient: TelegramClient | null = null;
  let watcher: TelegramWatcher | null = null;

  const startWatcher = async (client: TelegramClient): Promise<void> => {
    telegramClient = client;
    watcher = new TelegramWatcher(client, async (message) => service.processMessage(message));
    watcher.start().catch((err) => logger.error({ err }, 'Watcher error'));
    logger.info('Watcher started');
  };

  // setupOnboarding MUST be registered before setupCommands
  // so the real /start handler wins over the fallback stub
  setupOnboarding((client) => {
    startWatcher(client).catch((err) => logger.error({ err }, 'Failed to start watcher after onboarding'));
  });

  setupCommands(() => ({
    authorized: telegramClient !== null,
    watching: watcher !== null,
  }));

  const abortController = new AbortController();

  const stop = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down gracefully');
    abortController.abort();
    if (telegramClient) await telegramClient.disconnect();
    db.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));

  // Try auto-connect if session exists
  const cfg = getJsonConfig();
  const client = await tryAutoConnect();
  if (client) {
    await startWatcher(client);
    if (cfg.chatId) {
      await sendMessage(cfg.chatId, 'Бот запущен, мониторинг активен.');
    }
  } else {
    logger.info('No Telegram session found. Waiting for /start command...');
  }

  // Start bot polling (blocking)
  await startPolling(abortController.signal);
};

bootstrap().catch((error) => {
  logger.fatal({ err: error }, 'Fatal startup error');
  process.exit(1);
});
```

**Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "fix: register onboarding /start before commands fallback"
```

---

### Task 6: Final verification

**Step 1: Build**

Run: `npm run build`
Expected: Compiles without errors

**Step 2: Lint**

Run: `npm run lint`
Expected: No errors

**Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "chore: final cleanup after grammy migration"
```
