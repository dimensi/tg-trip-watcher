# Config & Onboarding Refactor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace env-based config with JSON hot-reload, add bot onboarding, switch to OpenAI SDK for OpenRouter, add bot commands for config management.

**Architecture:** Split config into env (4 secrets) + JSON file (everything else) with fs.watch hot-reload. Bot handles onboarding (chatId auto-save, Telegram auth via chat). OpenAI SDK replaces raw fetch for LLM calls. Bot commands read/write JSON config.

**Tech Stack:** TypeScript, openai SDK, zod, gramJS, better-sqlite3, pino, Telegram Bot API (raw fetch)

---

### Task 1: Install new dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install openai and zod**

Run: `npm install openai zod`

**Step 2: Verify installation**

Run: `npm ls openai zod`
Expected: Both packages listed without errors

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add openai and zod dependencies"
```

---

### Task 2: Create env config loader

**Files:**
- Create: `src/config/env.ts`

**Step 1: Write env.ts**

```typescript
import dotenv from 'dotenv';

dotenv.config();

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const envConfig = {
  telegramApiId: Number(required('TELEGRAM_API_ID')),
  telegramApiHash: required('TELEGRAM_API_HASH'),
  botToken: required('BOT_TOKEN'),
  openRouterApiKey: required('OPENROUTER_API_KEY'),
};
```

**Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: No errors (may have errors in other files importing old config — that's ok, we'll fix them later)

**Step 3: Commit**

```bash
git add src/config/env.ts
git commit -m "feat: add env config loader for secrets only"
```

---

### Task 3: Create JSON config with zod schema and hot-reload

**Files:**
- Create: `src/config/jsonConfig.ts`
- Create: `src/config/index.ts`

**Step 1: Write jsonConfig.ts**

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'json-config' });

const configSchema = z.object({
  chatId: z.number().nullable().default(null),
  telegram: z.object({
    channels: z.array(z.string()).default([]),
    sessionPath: z.string().default('./data/telegram.session'),
  }).default({}),
  openRouter: z.object({
    model: z.string().default('openai/gpt-4o-mini'),
    timeoutMs: z.number().default(15000),
    maxRetries: z.number().default(3),
    maxInputChars: z.number().default(4000),
    maxCostUsd: z.number().default(0.03),
  }).default({}),
  filters: z.object({
    maxPrice: z.number().optional(),
    departureCities: z.array(z.string()).default([]),
    minNights: z.number().optional(),
    maxNights: z.number().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  }).default({}),
  app: z.object({
    logLevel: z.string().default('info'),
    timezone: z.string().default('UTC'),
  }).default({}),
});

export type JsonConfig = z.infer<typeof configSchema>;

const CONFIG_PATH = path.resolve(process.env.CONFIG_PATH ?? './data/config.json');

type ConfigListener = (config: JsonConfig) => void;
const listeners: ConfigListener[] = [];

let current: JsonConfig;

const readConfigFile = (): JsonConfig => {
  const dir = path.dirname(CONFIG_PATH);
  fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(CONFIG_PATH)) {
    const defaults = configSchema.parse({});
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2), 'utf8');
    logger.info({ path: CONFIG_PATH }, 'Created default config file');
    return defaults;
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  return configSchema.parse(parsed);
};

const reload = (): void => {
  try {
    const next = readConfigFile();
    current = next;
    for (const listener of listeners) {
      listener(current);
    }
    logger.info('Config reloaded');
  } catch (error) {
    logger.error({ err: error }, 'Failed to reload config, keeping previous values');
  }
};

export const initJsonConfig = (): JsonConfig => {
  current = readConfigFile();
  return current;
};

export const getJsonConfig = (): JsonConfig => current;

export const updateJsonConfig = (updater: (draft: JsonConfig) => void): JsonConfig => {
  const clone = structuredClone(current);
  updater(clone);
  const validated = configSchema.parse(clone);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(validated, null, 2), 'utf8');
  current = validated;
  for (const listener of listeners) {
    listener(current);
  }
  return current;
};

export const onConfigChange = (listener: ConfigListener): void => {
  listeners.push(listener);
};

export const watchConfigFile = (): void => {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  fs.watch(CONFIG_PATH, () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => reload(), 300);
  });
  logger.info({ path: CONFIG_PATH }, 'Watching config file for changes');
};
```

**Step 2: Write config/index.ts barrel**

```typescript
export { envConfig } from './env';
export { initJsonConfig, getJsonConfig, updateJsonConfig, onConfigChange, watchConfigFile } from './jsonConfig';
export type { JsonConfig } from './jsonConfig';
```

**Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: May have errors in files still importing old `config.ts` — expected at this stage

**Step 4: Commit**

```bash
git add src/config/jsonConfig.ts src/config/index.ts
git commit -m "feat: add JSON config with zod validation and hot-reload"
```

---

### Task 4: Rewrite llmParser to use OpenAI SDK

**Files:**
- Modify: `src/parser/llmParser.ts`

**Step 1: Rewrite llmParser.ts**

Replace the entire file with:

```typescript
import OpenAI from 'openai';
import pino from 'pino';
import { envConfig, getJsonConfig } from '../config';
import { ParsedTour } from '../types/tour';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'llm-parser' });

const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: envConfig.openRouterApiKey,
});

const buildPrompt = (text: string, maxChars: number): string =>
  `Extract a tour offer from text. Return strict JSON only with keys:
destination(string), nights(number), departureCities(string[]), dateStart(YYYY-MM-DD), dateEnd(YYYY-MM-DD), price(number), bookingUrl(string), confidence(number 0..1).
If uncertain, still return best guess and lower confidence.

Text:\n${text.slice(0, maxChars)}`;

const validateParsed = (value: Partial<ParsedTour>): ParsedTour => {
  if (
    !value.destination ||
    !value.nights ||
    !value.departureCities?.length ||
    !value.dateStart ||
    !value.dateEnd ||
    !value.price ||
    !value.bookingUrl
  ) {
    throw new Error('LLM response missing required fields');
  }
  return {
    destination: value.destination,
    nights: value.nights,
    departureCities: value.departureCities,
    dateStart: value.dateStart,
    dateEnd: value.dateEnd,
    price: value.price,
    bookingUrl: value.bookingUrl,
    confidence: value.confidence ?? 0.6,
  };
};

export const llmParseTour = async (text: string): Promise<ParsedTour> => {
  const cfg = getJsonConfig().openRouter;

  const response = await client.chat.completions.create({
    model: cfg.model,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    max_tokens: 500,
    messages: [
      { role: 'system', content: 'You are an accurate travel offer extractor. Return valid JSON only.' },
      { role: 'user', content: buildPrompt(text, cfg.maxInputChars) },
    ],
  }, {
    timeout: cfg.timeoutMs,
    maxRetries: cfg.maxRetries,
  });

  const usage = response.usage;
  logger.info({ usage }, 'OpenRouter usage');

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('OpenRouter returned empty content');
  }

  const parsed = JSON.parse(content) as Partial<ParsedTour>;
  return validateParsed(parsed);
};
```

**Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: llmParser.ts should have no errors. Other files may still error.

**Step 3: Commit**

```bash
git add src/parser/llmParser.ts
git commit -m "feat: replace raw fetch with openai SDK for OpenRouter"
```

---

### Task 5: Create bot module with polling, onboarding, and commands

**Files:**
- Create: `src/bot/index.ts`
- Create: `src/bot/onboarding.ts`
- Create: `src/bot/commands.ts`

**Step 1: Write src/bot/index.ts — bot polling loop and command dispatch**

```typescript
import pino from 'pino';
import { envConfig, getJsonConfig, updateJsonConfig } from '../config';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'bot' });

const API_BASE = `https://api.telegram.org/bot${envConfig.botToken}`;

interface TgUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    from?: { id: number };
    text?: string;
  };
}

export const sendMessage = async (chatId: number, text: string): Promise<void> => {
  const response = await fetch(`${API_BASE}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  if (!response.ok) {
    const body = await response.text();
    logger.error({ body, chatId }, 'sendMessage failed');
  }
};

type CommandHandler = (chatId: number, args: string) => Promise<void>;

const commands = new Map<string, CommandHandler>();

export const registerCommand = (name: string, handler: CommandHandler): void => {
  commands.set(name, handler);
};

let onTextMessage: ((chatId: number, text: string) => Promise<void>) | null = null;

export const setTextHandler = (handler: ((chatId: number, text: string) => Promise<void>) | null): void => {
  onTextMessage = handler;
};

const isAuthorized = (chatId: number): boolean => {
  const cfg = getJsonConfig();
  return cfg.chatId === null || cfg.chatId === chatId;
};

const processUpdate = async (update: TgUpdate): Promise<void> => {
  const message = update.message;
  if (!message?.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();

  if (!isAuthorized(chatId)) {
    logger.warn({ chatId }, 'Unauthorized message ignored');
    return;
  }

  if (text.startsWith('/')) {
    const spaceIdx = text.indexOf(' ');
    const cmd = spaceIdx === -1 ? text.slice(1).toLowerCase() : text.slice(1, spaceIdx).toLowerCase();
    const args = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();

    const handler = commands.get(cmd);
    if (handler) {
      await handler(chatId, args);
    } else {
      const helpHandler = commands.get('help');
      if (helpHandler) await helpHandler(chatId, '');
    }
    return;
  }

  if (onTextMessage) {
    await onTextMessage(chatId, text);
  }
};

export const startPolling = async (signal: AbortSignal): Promise<void> => {
  let offset = 0;
  logger.info('Bot polling started');

  while (!signal.aborted) {
    try {
      const response = await fetch(`${API_BASE}/getUpdates?offset=${offset}&timeout=30`, {
        signal,
      });

      if (!response.ok) {
        logger.error({ status: response.status }, 'getUpdates failed');
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      const data = (await response.json()) as { ok: boolean; result: TgUpdate[] };
      for (const update of data.result) {
        await processUpdate(update);
        offset = update.update_id + 1;
      }
    } catch (error) {
      if (signal.aborted) break;
      logger.error({ err: error }, 'Polling error, retrying');
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
};
```

**Step 2: Write src/bot/onboarding.ts — /start + Telegram auth flow**

```typescript
import fs from 'node:fs';
import pino from 'pino';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { envConfig, getJsonConfig, updateJsonConfig } from '../config';
import { sendMessage, registerCommand, setTextHandler } from './index';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'onboarding' });

type OnAuthorized = (client: TelegramClient) => void;

export const setupOnboarding = (onAuthorized: OnAuthorized): void => {
  registerCommand('start', async (chatId: string | number) => {
    const numChatId = Number(chatId);

    updateJsonConfig((draft) => {
      draft.chatId = numChatId;
    });

    const cfg = getJsonConfig();
    const sessionPath = cfg.telegram.sessionPath;

    if (fs.existsSync(sessionPath)) {
      const sessionStr = fs.readFileSync(sessionPath, 'utf8');
      if (sessionStr) {
        await sendMessage(numChatId, 'Сессия найдена. Подключаюсь к Telegram...');
        try {
          const client = await connectWithSession(sessionStr);
          onAuthorized(client);
          await sendMessage(numChatId, '✅ Подключено! Мониторинг запущен.');
          return;
        } catch {
          await sendMessage(numChatId, 'Сессия устарела. Нужна повторная авторизация.');
        }
      }
    }

    await sendMessage(numChatId, 'Отправляю код авторизации на номер телефона...');
    await startAuthFlow(numChatId, onAuthorized);
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
  const phoneNumber = process.env.TELEGRAM_PHONE_NUMBER;

  if (!phoneNumber) {
    await sendMessage(chatId, 'Установите TELEGRAM_PHONE_NUMBER в .env и перезапустите.');
    return;
  }

  const client = new TelegramClient(
    new StringSession(''),
    envConfig.telegramApiId,
    envConfig.telegramApiHash,
    { connectionRetries: 10, useWSS: true }
  );

  let resolveCode: ((code: string) => void) | null = null;
  let resolvePassword: ((password: string) => void) | null = null;

  setTextHandler(async (_chatId: number, text: string) => {
    if (resolveCode) {
      resolveCode(text);
      resolveCode = null;
    } else if (resolvePassword) {
      resolvePassword(text);
      resolvePassword = null;
    }
  });

  try {
    await client.start({
      phoneNumber: async () => phoneNumber,
      phoneCode: async () => {
        await sendMessage(chatId, 'Введите код авторизации из Telegram:');
        return new Promise<string>((resolve) => {
          resolveCode = resolve;
        });
      },
      password: async () => {
        await sendMessage(chatId, 'Введите пароль 2FA:');
        return new Promise<string>((resolve) => {
          resolvePassword = resolve;
        });
      },
      onError: (err) => logger.error({ err }, 'Auth error'),
    });

    const sessionStr = String(client.session.save());
    const sessionPath = cfg.telegram.sessionPath;
    fs.mkdirSync(require('node:path').dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, sessionStr, 'utf8');

    setTextHandler(null);
    onAuthorized(client);
    await sendMessage(chatId, '✅ Авторизация успешна! Мониторинг запущен.');
  } catch (error) {
    setTextHandler(null);
    logger.error({ err: error }, 'Auth flow failed');
    await sendMessage(chatId, `❌ Ошибка авторизации: ${error instanceof Error ? error.message : 'unknown'}`);
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

**Step 3: Write src/bot/commands.ts — config management commands**

```typescript
import { getJsonConfig, updateJsonConfig } from '../config';
import { sendMessage, registerCommand } from './index';

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
  registerCommand('help', async (chatId) => {
    await sendMessage(chatId, HELP_TEXT);
  });

  registerCommand('status', async (chatId) => {
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

  registerCommand('filters', async (chatId) => {
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

  registerCommand('setprice', async (chatId, args) => {
    const price = Number(args);
    if (!args || Number.isNaN(price) || price <= 0) {
      await sendMessage(chatId, 'Использование: /setprice 50000');
      return;
    }
    updateJsonConfig((d) => { d.filters.maxPrice = price; });
    await sendMessage(chatId, `Макс. цена: ${price} ₽`);
  });

  registerCommand('nights', async (chatId, args) => {
    const parts = args.split(/\s+/);
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

  registerCommand('dates', async (chatId, args) => {
    const parts = args.split(/\s+/);
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
    updateJsonConfig((d) => { d.filters.dateFrom = from; d.filters.dateTo = to; });
    await sendMessage(chatId, `Даты: ${from} — ${to}`);
  });

  registerCommand('addcity', async (chatId, args) => {
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

  registerCommand('rmcity', async (chatId, args) => {
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

  registerCommand('channels', async (chatId) => {
    const channels = getJsonConfig().telegram.channels;
    if (channels.length === 0) {
      await sendMessage(chatId, 'Каналы не указаны. Добавьте: /addchannel @channel');
      return;
    }
    await sendMessage(chatId, `<b>Каналы:</b>\n${channels.join('\n')}`);
  });

  registerCommand('addchannel', async (chatId, args) => {
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
    await sendMessage(chatId, `Добавлен: ${args}`);
  });

  registerCommand('rmchannel', async (chatId, args) => {
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
    await sendMessage(chatId, `Удалён: ${args}`);
  });
};
```

**Step 4: Verify typecheck**

Run: `npx tsc --noEmit`

**Step 5: Commit**

```bash
git add src/bot/
git commit -m "feat: add bot module with polling, onboarding, and config commands"
```

---

### Task 6: Update notifier to use dynamic config

**Files:**
- Modify: `src/notifier/telegramNotifier.ts`

**Step 1: Rewrite telegramNotifier.ts**

```typescript
import pino from 'pino';
import { envConfig, getJsonConfig } from '../config';
import { ParsedTour } from '../types/tour';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'telegram-notifier' });

const formatTour = (tour: ParsedTour): string => {
  return [
    '🔥 Найден тур',
    '',
    `Направление: ${tour.destination}`,
    `Вылет: ${tour.departureCities.join(', ')}`,
    `Даты: ${tour.dateStart} - ${tour.dateEnd}`,
    `Ночей: ${tour.nights}`,
    `Цена: ${tour.price} ₽`,
    `Ссылка: ${tour.bookingUrl}`,
  ].join('\n');
};

export class TelegramNotifier {
  public async sendTour(tour: ParsedTour): Promise<void> {
    const chatId = getJsonConfig().chatId;
    if (!chatId) {
      logger.warn('Cannot send notification: chatId not set. Send /start to the bot.');
      return;
    }

    const response = await fetch(`https://api.telegram.org/bot${envConfig.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatTour(tour),
        disable_web_page_preview: false,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ errorBody }, 'Failed to send Telegram notification');
      throw new Error(`Telegram Bot API error: ${response.status}`);
    }

    logger.info('Tour notification sent');
  }
}
```

**Step 2: Commit**

```bash
git add src/notifier/telegramNotifier.ts
git commit -m "refactor: notifier uses dynamic config instead of static env"
```

---

### Task 7: Update database to use dynamic config

**Files:**
- Modify: `src/db.ts`

**Step 1: Rewrite db.ts constructor to accept path parameter**

```typescript
import Database from 'better-sqlite3';
import pino from 'pino';
import { ParsedTour, RawMessageContext, StoredTourRecord } from './types/tour';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'db' });

export class TourDatabase {
  private readonly db: Database.Database;

  public constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  // ... rest of the class stays exactly the same (migrate, saveTour, hasNotification, markNotificationSent, listTours, close)
```

Only change: constructor takes `dbPath: string` instead of using `config.database.path`. Remove the `import { config }` line.

**Step 2: Commit**

```bash
git add src/db.ts
git commit -m "refactor: db accepts path parameter instead of reading config directly"
```

---

### Task 8: Update tourService and watcher to use dynamic config

**Files:**
- Modify: `src/services/tourService.ts`
- Modify: `src/telegram/watcher.ts`

**Step 1: Update tourService.ts to use getJsonConfig()**

Replace `import { config } from '../config';` with `import { getJsonConfig } from '../config';`
Replace `config.filters` with `getJsonConfig().filters` in `processMessage`.
Remove `config` from logger creation — use `process.env.LOG_LEVEL`.

```typescript
import pino from 'pino';
import { getJsonConfig } from '../config';
import { TourDatabase } from '../db';
import { matchesFilters } from '../filters/tourFilters';
import { TelegramNotifier } from '../notifier/telegramNotifier';
import { parseTour } from '../parser';
import { RawMessageContext } from '../types/tour';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'tour-service' });

export class TourService {
  public constructor(
    private readonly db: TourDatabase,
    private readonly notifier: TelegramNotifier
  ) {}

  public async processMessage(message: RawMessageContext): Promise<void> {
    try {
      const parsed = await parseTour(message.text);
      const matched = matchesFilters(parsed, getJsonConfig().filters);
      const tourId = this.db.saveTour(message, parsed, matched);

      if (tourId === null) {
        logger.debug({ sourceChannel: message.sourceChannel, messageId: message.messageId }, 'Duplicate message ignored');
        return;
      }

      logger.info({ tourId, matched, confidence: parsed.confidence }, 'Tour saved');

      if (!matched) return;

      if (this.db.hasNotification(tourId)) {
        logger.debug({ tourId }, 'Notification already sent');
        return;
      }

      await this.notifier.sendTour(parsed);
      this.db.markNotificationSent(tourId);
    } catch (error) {
      logger.warn({ err: error, message }, 'Failed to process message as tour');
    }
  }
}
```

**Step 2: Update watcher.ts to use getJsonConfig()**

Replace `import { config } from '../config';` with `import { getJsonConfig } from '../config';`
Replace `config.telegram.channels` with `getJsonConfig().telegram.channels`.
Remove `config` from logger creation — use `process.env.LOG_LEVEL`.

```typescript
import pino from 'pino';
import { NewMessage } from 'telegram/events';
import { Api, TelegramClient } from 'telegram';
import { getJsonConfig } from '../config';
import { RawMessageContext } from '../types/tour';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'telegram-watcher' });

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class TelegramWatcher {
  public constructor(
    private readonly client: TelegramClient,
    private readonly onMessage: (message: RawMessageContext) => Promise<void>
  ) {}

  public async start(): Promise<void> {
    const channels = getJsonConfig().telegram.channels;
    if (channels.length === 0) {
      throw new Error('No channels configured. Use /addchannel to add channels.');
    }

    logger.info({ channels }, 'Starting Telegram watcher');

    this.client.addEventHandler(async (event) => {
      try {
        const message = event.message as Api.Message;
        const channel = await message.getChat();
        const channelTitle = channel && 'title' in channel ? channel.title : 'unknown';
        const text = message.message;

        if (!text) return;

        await this.onMessage({
          sourceChannel: channelTitle,
          messageId: message.id,
          text,
        });
      } catch (error) {
        const maybeError = error as { errorMessage?: string; seconds?: number };
        if (maybeError.errorMessage?.includes('FLOOD_WAIT') && maybeError.seconds) {
          logger.warn({ seconds: maybeError.seconds }, 'Flood wait detected');
          await sleep(maybeError.seconds * 1000);
          return;
        }
        logger.error({ err: error }, 'Failed to process Telegram message event');
      }
    }, new NewMessage({ chats: channels }));

    while (true) {
      try {
        await this.client.connect();
        await this.client.disconnected;
      } catch (error) {
        logger.error({ err: error }, 'Telegram connection dropped, retrying');
        await sleep(3000);
      }
    }
  }
}
```

**Step 3: Commit**

```bash
git add src/services/tourService.ts src/telegram/watcher.ts
git commit -m "refactor: tourService and watcher use dynamic config"
```

---

### Task 9: Rewrite index.ts — new startup flow

**Files:**
- Modify: `src/index.ts`
- Delete: `src/config.ts` (old config)
- Delete: `src/telegram/client.ts` (replaced by bot/onboarding.ts)

**Step 1: Rewrite src/index.ts**

```typescript
import pino from 'pino';
import { envConfig, initJsonConfig, getJsonConfig, watchConfigFile } from './config';
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
  const jsonConfig = initJsonConfig();
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

  setupCommands(() => ({
    authorized: telegramClient !== null,
    watching: watcher !== null,
  }));

  setupOnboarding((client) => {
    startWatcher(client).catch((err) => logger.error({ err }, 'Failed to start watcher after onboarding'));
  });

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

**Step 2: Delete old config.ts and telegram/client.ts**

Run:
```bash
rm src/config.ts src/telegram/client.ts
```

**Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Update .env.example**

```
# Secrets (required)
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
BOT_TOKEN=
OPENROUTER_API_KEY=

# Optional
TELEGRAM_PHONE_NUMBER=+79991234567
SQLITE_PATH=./data/tours.db
CONFIG_PATH=./data/config.json
LOG_LEVEL=info
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: new startup flow — bot-first with auto-connect and onboarding"
```

---

### Task 10: Update parser/index.ts import

**Files:**
- Modify: `src/parser/index.ts`

**Step 1: Verify parser/index.ts**

The parser barrel imports `regexParser` and `llmParser`. The `llmParser` now uses the new config. The `regexParser` has no config imports. The barrel itself has no config imports. No changes needed unless typecheck shows errors.

Run: `npx tsc --noEmit`
Expected: No errors

If there are errors, fix them.

**Step 2: Commit if changes were needed**

---

### Task 11: Update Docker and documentation

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker/Dockerfile`
- Modify: `.env.example` (done in Task 9)

**Step 1: Update docker-compose.yml**

Ensure the volume mounts `data/` directory for config.json and session persistence.
Update environment section to only list the 4 required secrets + optional vars.

**Step 2: Update Dockerfile**

Ensure `data/` directory is created in the container.

**Step 3: Commit**

```bash
git add docker-compose.yml docker/Dockerfile .env.example
git commit -m "chore: update Docker config and env example for new config system"
```

---

### Task 12: Final integration test

**Step 1: Build**

Run: `npm run build`
Expected: Compiles without errors

**Step 2: Lint**

Run: `npm run lint`
Expected: No lint errors

**Step 3: Manual test plan**

1. Delete `data/` directory (fresh start)
2. Set up `.env` with 4 secrets + `TELEGRAM_PHONE_NUMBER`
3. Run `npm run dev`
4. Verify `data/config.json` is created with defaults
5. Send `/start` to bot → verify chatId is saved
6. Send auth code when prompted → verify session is saved
7. Verify watcher starts monitoring
8. Test `/filters`, `/setprice 50000`, `/addcity Казань`
9. Verify `config.json` updates on disk
10. Edit `config.json` manually → verify hot-reload (check logs)
11. Restart app → verify auto-connect works

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup after config and onboarding refactor"
```
