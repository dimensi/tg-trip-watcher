import { getJsonConfig, JsonConfig, updateJsonConfig } from '../config';
import { createLogger } from '../logging/logger';
import { bot, sendMessage } from './index';

const logger = createLogger('bot-commands');

type RuntimeStatus = { authorized: boolean; watching: boolean };
type ReloadRuntime = () => Promise<void>;

export const BOT_COMMANDS = [
  { command: 'start', description: 'Запустить онбординг и подключение' },
  { command: 'help', description: 'Список команд' },
  { command: 'status', description: 'Текущее состояние и настройки' },
  { command: 'filters', description: 'Показать фильтры' },
  { command: 'setprice', description: 'Установить максимум цены' },
  { command: 'nights', description: 'Ночи: min max, одно число, или off' },
  { command: 'dates', description: 'Установить диапазон дат' },
  { command: 'addcity', description: 'Добавить город вылета' },
  { command: 'rmcity', description: 'Удалить город вылета' },
  { command: 'addarrcity', description: 'Добавить город прибытия' },
  { command: 'rmarrcity', description: 'Удалить город прибытия' },
  { command: 'reload', description: 'Перезагрузить runtime-конфигурацию' },
  { command: 'channels', description: 'Показать каналы мониторинга' },
  { command: 'addchannel', description: 'Добавить канал мониторинга' },
  { command: 'rmchannel', description: 'Удалить канал мониторинга' },
] as const;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const RETRYABLE_NETWORK_CODES = new Set([
  'EAI_AGAIN',
  'EAI_NODATA',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENETUNREACH',
]);

/** Grammy HttpError nests the underlying fetch error under `.error`; Node may use `.cause`. */
const getNetworkErrorCode = (err: unknown): string | undefined => {
  if (!err || typeof err !== 'object') return undefined;
  const o = err as Record<string, unknown>;
  const nested = o.error;
  if (nested && typeof nested === 'object') {
    const e = nested as { code?: unknown; errno?: unknown };
    if (typeof e.code === 'string') return e.code;
    if (typeof e.errno === 'string') return e.errno;
  }
  if (typeof o.code === 'string') return o.code;
  const cause = o.cause;
  if (cause && typeof cause === 'object') {
    const c = (cause as { code?: unknown }).code;
    if (typeof c === 'string') return c;
  }
  return undefined;
};

const isRetryableSetCommandsError = (err: unknown): boolean => {
  const code = getNetworkErrorCode(err);
  return code !== undefined && RETRYABLE_NETWORK_CODES.has(code);
};

const setMyCommandsWithRetry = async (
  commands: typeof BOT_COMMANDS,
  maxAttempts = 6
): Promise<void> => {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await bot.api.setMyCommands(commands);
      if (attempt > 1) {
        logger.info({ attempt }, 'setMyCommands succeeded after retry');
      }
      return;
    } catch (err) {
      const retryable = isRetryableSetCommandsError(err);
      if (!retryable || attempt === maxAttempts) {
        logger.error({ err, attempt, maxAttempts, retryable }, 'Failed to register bot commands via setMyCommands');
        return;
      }
      const delayMs = Math.min(1000 * 2 ** (attempt - 1), 30_000);
      logger.warn(
        { attempt, maxAttempts, delayMs, code: getNetworkErrorCode(err) },
        'setMyCommands failed, retrying'
      );
      await sleep(delayMs);
    }
  }
};

const HELP_TEXT = `<b>Доступные команды:</b>

/help — список команд
/status — статус бота
/filters — текущие фильтры
/setprice 50000 — установить макс. цену
/nights 5 12 — от 5 до 12 ночей; /nights 7 — ровно 7; /nights off — без ограничения
/dates 2026-03-01 2026-09-01 — диапазон дат
/addcity Казань — добавить город вылета
/rmcity Казань — убрать город вылета
/addarrcity Стамбул — добавить город прилёта
/rmarrcity Стамбул — убрать город прилёта
/reload — перезагрузить runtime-конфигурацию
/channels — список каналов
/addchannel @deals — добавить канал
/rmchannel @deals — убрать канал`;

export const formatStatusText = (cfg: JsonConfig, status: RuntimeStatus): string => {
  const channels = cfg.telegram.channels.length > 0 ? cfg.telegram.channels.join(', ') : 'не добавлены';
  const cities = cfg.filters.departureCities.length > 0 ? cfg.filters.departureCities.join(', ') : 'любые';
  const chatBinding = cfg.chatId !== null ? String(cfg.chatId) : 'не привязан';

  return [
    '<b>Статус бота</b>',
    `Пользователь Telegram: ${status.authorized ? '✅ подключен' : '❌ не подключен'}`,
    `Мониторинг: ${status.watching ? '✅ активен' : '❌ не активен'}`,
    `Привязанный чат: ${chatBinding}`,
    '',
    '<b>Каналы</b>',
    `${channels}`,
    `Сессия: ${cfg.telegram.sessionPath}`,
    '',
    '<b>Фильтры</b>',
    `Цена до: ${cfg.filters.maxPrice ?? 'не задана'}`,
    `Города вылета: ${cities}`,
    `Города прилёта: ${cfg.filters.arrivalCities.length > 0 ? cfg.filters.arrivalCities.join(', ') : 'любые'}`,
    `Ночей: ${cfg.filters.minNights ?? '—'} — ${cfg.filters.maxNights ?? '—'}`,
    `Даты: ${cfg.filters.dateFrom ?? '—'} — ${cfg.filters.dateTo ?? '—'}`,
    '',
    '<b>LLM</b>',
    `Модель: ${cfg.openRouter.model}`,
    `Таймаут: ${cfg.openRouter.timeoutMs} ms`,
    `Повторы: ${cfg.openRouter.maxRetries}`,
    `Лимит текста: ${cfg.openRouter.maxInputChars}`,
    `Макс. стоимость: ${cfg.openRouter.maxCostUsd}`,
  ].join('\n');
};

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
  void setMyCommandsWithRetry(BOT_COMMANDS);

  bot.command('help', async (ctx) => {
    await sendMessage(ctx.chat.id, HELP_TEXT);
  });

  bot.command('status', async (ctx) => {
    const chatId = ctx.chat.id;
    const cfg = getJsonConfig();
    const status = getStatus();
    await sendMessage(chatId, formatStatusText(cfg, status));
  });

  bot.command('filters', async (ctx) => {
    const chatId = ctx.chat.id;
    const f = getJsonConfig().filters;
    const lines = [
      '<b>Фильтры:</b>',
      `Макс. цена: ${f.maxPrice ?? 'не задана'}`,
      `Города вылета: ${f.departureCities.length > 0 ? f.departureCities.join(', ') : 'любые'}`,
      `Города прилёта: ${f.arrivalCities.length > 0 ? f.arrivalCities.join(', ') : 'любые'}`,
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
    const raw = (ctx.match ?? '').trim();
    if (!raw) {
      await sendMessage(
        chatId,
        [
          'Использование:',
          '/nights 5 12 — от 5 до 12 ночей',
          '/nights 7 — ровно 7 ночей',
          '/nights off — убрать ограничение по ночам',
        ].join('\n'),
      );
      return;
    }

    const token = raw.toLowerCase();
    if (token === 'off' || token === 'clear' || token === 'сброс') {
      updateJsonConfig((d) => {
        delete d.filters.minNights;
        delete d.filters.maxNights;
      });
      await sendMessage(chatId, 'Ограничение по ночам снято (любое число ночей).');
      return;
    }

    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      const n = Number(parts[0]);
      if (Number.isNaN(n) || n < 0 || !Number.isInteger(n)) {
        await sendMessage(chatId, 'Укажите целое число ночей, например: /nights 7');
        return;
      }
      updateJsonConfig((d) => {
        d.filters.minNights = n;
        d.filters.maxNights = n;
      });
      await sendMessage(chatId, `Ночей: ровно ${n}`);
      return;
    }

    if (parts.length === 2) {
      const [min, max] = parts.map(Number);
      if (Number.isNaN(min) || Number.isNaN(max) || min < 0 || max < min || !Number.isInteger(min) || !Number.isInteger(max)) {
        await sendMessage(chatId, 'Некорректные значения. Пример: /nights 5 12');
        return;
      }
      updateJsonConfig((d) => {
        d.filters.minNights = min;
        d.filters.maxNights = max;
      });
      await sendMessage(chatId, `Ночей: ${min} — ${max}`);
      return;
    }

    await sendMessage(chatId, 'Слишком много аргументов. Пример: /nights 5 12 или /nights 7');
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

  bot.command('reload', async (ctx) => {
    const chatId = ctx.chat.id;
    const result = await runReloadCommand(reloadRuntime);
    await sendMessage(chatId, result);
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
    await sendMessage(chatId, `Добавлен: ${args}`);
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
    await sendMessage(chatId, `Удалён: ${args}`);
  });
};
