import test from 'node:test';
import assert from 'node:assert/strict';
import { BOT_COMMANDS, formatStatusText, resetFilters, runReloadCommand } from './commands';
import { JsonConfig } from '../config';

test('BOT_COMMANDS contains all expected command names', () => {
  const commands = BOT_COMMANDS.map((entry) => entry.command);
  assert.deepEqual(commands, [
    'start',
    'help',
    'status',
    'filters',
    'resetfilters',
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
});

test('resetFilters clears every filter and preserves unrelated config', () => {
  const cfg: JsonConfig = {
    chatId: 123456789,
    telegram: {
      channels: ['@deals'],
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
      departureCities: ['Москва'],
      arrivalCities: ['Стамбул'],
      minNights: 5,
      maxNights: 12,
      dateFrom: '2026-04-01',
      dateTo: '2026-05-01',
    },
  };
  const unrelatedConfig = {
    chatId: cfg.chatId,
    telegram: structuredClone(cfg.telegram),
    openRouter: structuredClone(cfg.openRouter),
  };

  resetFilters(cfg);
  resetFilters(cfg);

  assert.deepEqual(cfg.filters, {
    departureCities: [],
    arrivalCities: [],
  });
  assert.deepEqual(
    { chatId: cfg.chatId, telegram: cfg.telegram, openRouter: cfg.openRouter },
    unrelatedConfig,
  );
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
      arrivalCities: ['Стамбул', 'Анталья'],
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
  assert.match(text, /Города прилёта: Стамбул, Анталья/);
  assert.match(text, /Ночей: 5 — 12/);
  assert.match(text, /Даты: 2026-04-01 — 2026-05-01/);
  assert.match(text, /<b>LLM<\/b>/);
  assert.match(text, /Модель: google\/gemini-2\.5-flash-lite/);
});

test('runReloadCommand returns success text when reload completes', async () => {
  const text = await runReloadCommand(async () => {});
  assert.match(text, /перезагружены/);
});

test('runReloadCommand returns error text when reload fails', async () => {
  const text = await runReloadCommand(async () => {
    throw new Error('boom');
  });
  assert.match(text, /Ошибка reload: boom/);
});
