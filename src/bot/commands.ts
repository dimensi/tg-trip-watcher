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
