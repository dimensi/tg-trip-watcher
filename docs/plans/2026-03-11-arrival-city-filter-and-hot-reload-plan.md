# Arrival City Filter & Watcher Hot Reload Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add arrival-city list filtering with partial matching, add bot commands to manage it, and remove manual restart requirement for channel updates by introducing watcher hot reload plus `/reload` fallback.

**Architecture:** Keep filters config-driven in `data/config.json` and continue reading them at message-processing time through `getJsonConfig()`. Extend filter schema/type with `arrivalCities`, implement partial case-insensitive match in `matchesFilters`, and wire new bot commands. Introduce explicit watcher subscription lifecycle (`start`, `reload`, `stop`) so channel changes can be applied automatically on config updates and manually with `/reload`.

**Tech Stack:** TypeScript, Node test runner (`tsx --test`), grammy, gramJS (`telegram`), zod, pino.

---

### Task 1: Add arrival city to config and types

**Files:**
- Modify: `src/types/tour.ts`
- Modify: `src/config/jsonConfig.ts`
- Modify: `src/bot/commands.test.ts`

**Step 1: Write the failing test (status rendering includes arrival cities)**

Add to `src/bot/commands.test.ts` config fixture and expectation:

```ts
filters: {
  maxPrice: 70000,
  departureCities: ['Пермь', 'Москва'],
  arrivalCities: ['Стамбул', 'Анталья'],
  minNights: 5,
  maxNights: 12,
  dateFrom: '2026-04-01',
  dateTo: '2026-05-01',
},

assert.match(text, /Города прилёта: Стамбул, Анталья/);
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/bot/commands.test.ts`
Expected: FAIL because `arrivalCities` is missing in config/type and output text.

**Step 3: Write minimal implementation**

In `src/types/tour.ts`:

```ts
export interface TourFilters {
  maxPrice?: number;
  departureCities: string[];
  arrivalCities: string[];
  minNights?: number;
  maxNights?: number;
  dateFrom?: string;
  dateTo?: string;
}
```

In `src/config/jsonConfig.ts` schema defaults:

```ts
filters: z.object({
  maxPrice: z.number().optional(),
  departureCities: z.array(z.string()).default([]),
  arrivalCities: z.array(z.string()).default([]),
  minNights: z.number().optional(),
  maxNights: z.number().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
}).default({ departureCities: [], arrivalCities: [] }),
```

In `src/bot/commands.ts` status formatter:

```ts
`Города прилёта: ${cfg.filters.arrivalCities.length > 0 ? cfg.filters.arrivalCities.join(', ') : 'любые'}`,
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test src/bot/commands.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/types/tour.ts src/config/jsonConfig.ts src/bot/commands.ts src/bot/commands.test.ts
git commit -m "feat: add arrival cities to config schema and status output"
```

---

### Task 2: Implement arrival-city filtering logic with partial match

**Files:**
- Modify: `src/filters/tourFilters.test.ts`
- Modify: `src/filters/tourFilters.ts`

**Step 1: Write failing tests**

Add tests to `src/filters/tourFilters.test.ts`:

```ts
test('matchesFilters skips arrival city check when filter list is empty', () => {
  const filters: TourFilters = { ...baseFilters, arrivalCities: [] };
  const inRangeTour: ParsedTour = { ...baseTour, destination: 'Стамбул (SAW)', dateEnd: '2026-05-01' };
  assert.equal(matchesFilters(inRangeTour, filters), true);
});

test('matchesFilters applies arrival city filter with case-insensitive partial matching', () => {
  const filters: TourFilters = { ...baseFilters, arrivalCities: ['стамбул'] };
  const inRangeTour: ParsedTour = { ...baseTour, destination: 'Стамбул (SAW)', dateEnd: '2026-05-01' };
  assert.equal(matchesFilters(inRangeTour, filters), true);
});

test('matchesFilters rejects when no arrival token matches destination', () => {
  const filters: TourFilters = { ...baseFilters, arrivalCities: ['Анталья'] };
  const inRangeTour: ParsedTour = { ...baseTour, destination: 'Стамбул', dateEnd: '2026-05-01' };
  assert.equal(matchesFilters(inRangeTour, filters), false);
});
```

Also update all existing `TourFilters` fixtures to include `arrivalCities: []`.

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/filters/tourFilters.test.ts`
Expected: FAIL due missing arrival filter behavior.

**Step 3: Write minimal implementation**

In `src/filters/tourFilters.ts`:

```ts
if (filters.arrivalCities.length > 0) {
  const destination = tour.destination.trim().toLowerCase();
  const tokens = filters.arrivalCities
    .map((city) => city.trim().toLowerCase())
    .filter(Boolean);

  const hasAllowedArrival = tokens.some((token) => destination.includes(token));
  if (!hasAllowedArrival) {
    return false;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test src/filters/tourFilters.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/filters/tourFilters.ts src/filters/tourFilters.test.ts
git commit -m "feat: add partial arrival-city filtering"
```

---

### Task 3: Add bot commands for arrival filters and update help text

**Files:**
- Modify: `src/bot/commands.ts`
- Modify: `src/bot/commands.test.ts`

**Step 1: Write failing tests**

In `src/bot/commands.test.ts`, extend command list expectation:

```ts
assert.deepEqual(commands, [
  'start',
  'help',
  'status',
  'filters',
  'setprice',
  'nights',
  'dates',
  'addcity',
  'rmcity',
  'addarrcity',
  'rmarrcity',
  'reload',
  'channels',
  'addchannel',
  'rmchannel',
]);
```

Add filter output expectations:

```ts
assert.match(text, /Города прилёта: Стамбул, Анталья/);
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/bot/commands.test.ts`
Expected: FAIL because commands/output are not updated.

**Step 3: Write minimal implementation**

In `src/bot/commands.ts`:

- Add command descriptors and help lines for `/addarrcity`, `/rmarrcity`, `/reload`.
- Update `/filters` and status output to include arrival list.
- Implement handlers:

```ts
bot.command('addarrcity', async (ctx) => {
  const chatId = ctx.chat.id;
  const args = (ctx.match ?? '').trim();
  if (!args) {
    await sendMessage(chatId, 'Использование: /addarrcity Стамбул');
    return;
  }
  const cfg = getJsonConfig();
  if (cfg.filters.arrivalCities.includes(args)) {
    await sendMessage(chatId, `${args} уже в списке прилёта`);
    return;
  }
  updateJsonConfig((d) => { d.filters.arrivalCities.push(args); });
  await sendMessage(chatId, `Добавлен прилёт: ${args}\nГорода прилёта: ${getJsonConfig().filters.arrivalCities.join(', ')}`);
});

bot.command('rmarrcity', async (ctx) => {
  const chatId = ctx.chat.id;
  const args = (ctx.match ?? '').trim();
  if (!args) {
    await sendMessage(chatId, 'Использование: /rmarrcity Стамбул');
    return;
  }
  const cfg = getJsonConfig();
  if (!cfg.filters.arrivalCities.includes(args)) {
    await sendMessage(chatId, `${args} не найден в списке прилёта`);
    return;
  }
  updateJsonConfig((d) => {
    d.filters.arrivalCities = d.filters.arrivalCities.filter((c) => c !== args);
  });
  const cities = getJsonConfig().filters.arrivalCities;
  await sendMessage(chatId, `Удалён прилёт: ${args}\nГорода прилёта: ${cities.length > 0 ? cities.join(', ') : 'любые'}`);
});
```

Note: `/reload` handler is added in Task 4 after wiring reload dependency.

**Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/bot/commands.test.ts`
Expected: PASS for command metadata and text rendering.

**Step 5: Commit**

```bash
git add src/bot/commands.ts src/bot/commands.test.ts
git commit -m "feat: add arrival city management bot commands"
```

---

### Task 4: Wire `/reload` command and command-level reload dependency

**Files:**
- Modify: `src/bot/commands.ts`
- Modify: `src/bot/commands.test.ts`
- Modify: `src/index.ts`

**Step 1: Write failing test for reload callback contract**

In `src/bot/commands.test.ts`, add unit test for pure helper (extract helper first if needed):

```ts
test('BOT_COMMANDS includes reload command', () => {
  const commands = BOT_COMMANDS.map((entry) => entry.command);
  assert.ok(commands.includes('reload'));
});
```

Then add a focused test for handler behavior by extracting handler factory (recommended minimal seam):

```ts
import { runReloadCommand } from './commands';

test('runReloadCommand returns success text when reload resolves', async () => {
  const msg = await runReloadCommand(async () => {});
  assert.match(msg, /перезагружены|применены/i);
});

test('runReloadCommand returns error text when reload throws', async () => {
  const msg = await runReloadCommand(async () => { throw new Error('boom'); });
  assert.match(msg, /Ошибка reload: boom/);
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/bot/commands.test.ts`
Expected: FAIL because helper and wiring do not exist.

**Step 3: Write minimal implementation**

In `src/bot/commands.ts`:

```ts
type RuntimeStatus = { authorized: boolean; watching: boolean };
type ReloadRuntime = () => Promise<void>;

export const runReloadCommand = async (reloadRuntime: ReloadRuntime): Promise<string> => {
  try {
    await reloadRuntime();
    return '✅ Конфигурация и подписки перезагружены.';
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown';
    return `❌ Ошибка reload: ${reason}`;
  }
};

export const setupCommands = (
  getStatus: () => RuntimeStatus,
  reloadRuntime: ReloadRuntime
): void => {
  // ...
  bot.command('reload', async (ctx) => {
    const text = await runReloadCommand(reloadRuntime);
    await sendMessage(ctx.chat.id, text);
  });
};
```

In `src/index.ts`, pass `reloadRuntime` callback into `setupCommands` (temporary stub allowed until Task 5):

```ts
setupCommands(
  () => ({ authorized: telegramClient !== null, watching: watcher !== null }),
  async () => { /* implemented in Task 5 */ }
);
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test src/bot/commands.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/bot/commands.ts src/bot/commands.test.ts src/index.ts
git commit -m "feat: add reload command contract and command wiring"
```

---

### Task 5: Implement watcher subscription lifecycle and hot reload

**Files:**
- Modify: `src/telegram/watcher.ts`
- Modify: `src/index.ts`
- Create: `src/telegram/watcher.test.ts`

**Step 1: Write failing lifecycle tests**

Create `src/telegram/watcher.test.ts` with fake client:

```ts
class FakeClient {
  public connected = true;
  public handlers: Array<{ cb: CallableFunction; event: unknown }> = [];
  addEventHandler(cb: CallableFunction, event: unknown): void {
    this.handlers.push({ cb, event });
  }
  removeEventHandler(cb: CallableFunction, event: unknown): void {
    this.handlers = this.handlers.filter((h) => h.cb !== cb || h.event !== event);
  }
  async connect(): Promise<void> {}
}

test('TelegramWatcher.reload replaces previous subscription with new channels', async () => {
  const client = new FakeClient();
  const watcher = new TelegramWatcher(client as never, async () => {});

  await watcher.start(['@one']);
  assert.equal(client.handlers.length, 1);

  await watcher.reload(['@two']);
  assert.equal(client.handlers.length, 1);
});

test('TelegramWatcher.stop removes active subscription', async () => {
  const client = new FakeClient();
  const watcher = new TelegramWatcher(client as never, async () => {});

  await watcher.start(['@one']);
  watcher.stop();
  assert.equal(client.handlers.length, 0);
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/telegram/watcher.test.ts`
Expected: FAIL because lifecycle API does not exist.

**Step 3: Write minimal implementation**

Refactor `src/telegram/watcher.ts`:

```ts
export class TelegramWatcher {
  private activeHandler: ((event: NewMessage.Event) => Promise<void>) | null = null;
  private activeEvent: NewMessage | null = null;

  public async start(channels: string[]): Promise<void> {
    if (channels.length === 0) {
      throw new Error('No channels configured. Use /addchannel to add channels.');
    }

    await this.ensureConnected();
    this.bind(channels);
  }

  public async reload(channels: string[]): Promise<void> {
    this.stop();
    await this.start(channels);
  }

  public stop(): void {
    if (this.activeHandler && this.activeEvent) {
      this.client.removeEventHandler(this.activeHandler, this.activeEvent);
    }
    this.activeHandler = null;
    this.activeEvent = null;
  }

  private bind(channels: string[]): void {
    const event = new NewMessage({ chats: channels });
    const handler = async (eventData: NewMessage.Event) => {
      // existing message handling logic
    };

    this.client.addEventHandler(handler, event);
    this.activeHandler = handler;
    this.activeEvent = event;
  }

  private async ensureConnected(): Promise<void> {
    if (shouldConnectClient(this.client.connected)) {
      await this.client.connect();
    }
  }
}
```

Then implement `reloadRuntime` in `src/index.ts`:

```ts
const reloadRuntime = async (): Promise<void> => {
  const channels = getJsonConfig().telegram.channels;
  const configError = watcherConfigErrorForChannels(channels);
  if (configError) {
    throw new Error(configError);
  }
  if (!telegramClient || !watcher) {
    throw new Error('Telegram клиент не авторизован. Выполните /start.');
  }
  await watcher.reload(channels);
};
```

Use this callback in `setupCommands`.

**Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/telegram/watcher.test.ts`
Expected: PASS.

Run: `npx tsx --test src/bot/commands.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/telegram/watcher.ts src/telegram/watcher.test.ts src/index.ts src/bot/commands.ts
git commit -m "feat: add watcher lifecycle and reload runtime path"
```

---

### Task 6: Auto-reload channels on config changes

**Files:**
- Modify: `src/index.ts`

**Step 1: Write failing test for channel-change trigger (extract pure helper)**

Add helper in `src/index.ts` (or move to small new module) and test it in `src/index.test.ts`:

```ts
import { shouldReloadChannels } from './index';

test('shouldReloadChannels returns true when channel lists differ', () => {
  assert.equal(shouldReloadChannels(['@a'], ['@b']), true);
  assert.equal(shouldReloadChannels(['@a', '@b'], ['@a', '@b']), false);
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test src/index.test.ts`
Expected: FAIL because helper is missing.

**Step 3: Write minimal implementation**

In `src/index.ts`:

```ts
export const shouldReloadChannels = (prev: string[], next: string[]): boolean => {
  if (prev.length !== next.length) return true;
  return prev.some((value, index) => value !== next[index]);
};
```

Track previous channels and subscribe to config updates:

```ts
let lastChannels = [...getJsonConfig().telegram.channels];

onConfigChange((cfg) => {
  const nextChannels = [...cfg.telegram.channels];
  if (!shouldReloadChannels(lastChannels, nextChannels)) return;

  if (!telegramClient || !watcher) {
    lastChannels = nextChannels;
    return;
  }

  void watcher.reload(nextChannels)
    .then(() => {
      lastChannels = nextChannels;
      logger.info({ channels: nextChannels }, 'Watcher channels reloaded from config change');
    })
    .catch(async (err) => {
      logger.error({ err }, 'Failed to reload watcher after config change');
      if (cfg.chatId) {
        const reason = err instanceof Error ? err.message : 'unknown';
        await sendMessage(cfg.chatId, `❌ Не удалось применить каналы: ${reason}`);
      }
    });
});
```

**Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/index.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/index.ts src/index.test.ts
git commit -m "feat: auto-reload watcher on channel config changes"
```

---

### Task 7: End-to-end verification and docs alignment

**Files:**
- Modify: `README.md`
- Modify: `.env.example` (only if filter docs mention outdated behavior)

**Step 1: Update docs**

In `README.md` command/filter section, add:

```md
- Arrival cities are supported via `arrivalCities` in `data/config.json`.
- Matching is partial and case-insensitive.
- Channel changes are applied automatically; `/reload` is available as manual fallback.
```

**Step 2: Run full verification**

Run: `npx tsx --test src/**/*.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

**Step 3: Commit**

```bash
git add README.md .env.example
git commit -m "docs: document arrival filters and runtime reload behavior"
```

---

### Task 8: Final integration commit (if squash-style flow is preferred)

**Files:**
- No code changes required.

**Step 1: Inspect history**

Run: `git log --oneline -n 8`
Expected: The feature is split into reviewable commits from Tasks 1-7.

**Step 2: Optional integration PR note**

Prepare PR summary with:
- arrival-city filtering behavior
- new commands (`/addarrcity`, `/rmarrcity`, `/reload`)
- automatic channel hot reload behavior
- test evidence

**Step 3: Commit**

No commit required unless follow-up fixes are needed.
