import test from 'node:test';
import assert from 'node:assert/strict';
import { BOT_COMMANDS, formatStatusText } from './commands';
import { JsonConfig } from '../config';

test('BOT_COMMANDS contains all expected command names', () => {
  const commands = BOT_COMMANDS.map((entry) => entry.command);
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
    'channels',
    'addchannel',
    'rmchannel',
  ]);
});

test('formatStatusText renders human-readable runtime and config status', () => {
  const cfg: JsonConfig = {
    chatId: 123456789,
    telegram: {
      channels: ['@deals_one', '@deals_two'],
      sessionPath: './data/telegram.session',
    },
    openRouter: {
      model: 'google/gemini-2.5-flash-lite',
      timeoutMs: 15000,
      maxRetries: 3,
      maxInputChars: 4000,
      maxCostUsd: 1,
    },
    filters: {
      maxPrice: 70000,
      departureCities: ['Пермь', 'Москва'],
      minNights: 5,
      maxNights: 12,
      dateFrom: '2026-04-01',
      dateTo: '2026-05-01',
    },
  };

  const text = formatStatusText(cfg, { authorized: true, watching: false });

  assert.match(text, /<b>Статус бота<\/b>/);
  assert.match(text, /Пользователь Telegram: ✅ подключен/);
  assert.match(text, /Мониторинг: ❌ не активен/);
  assert.match(text, /Привязанный чат: 123456789/);
  assert.match(text, /<b>Каналы<\/b>/);
  assert.match(text, /@deals_one, @deals_two/);
  assert.match(text, /Сессия: \.\/data\/telegram\.session/);
  assert.match(text, /<b>Фильтры<\/b>/);
  assert.match(text, /Цена до: 70000/);
  assert.match(text, /Города вылета: Пермь, Москва/);
  assert.match(text, /Ночей: 5 — 12/);
  assert.match(text, /Даты: 2026-04-01 — 2026-05-01/);
  assert.match(text, /<b>LLM<\/b>/);
  assert.match(text, /Модель: google\/gemini-2\.5-flash-lite/);
});
