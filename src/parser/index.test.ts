import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTour } from './index';
import { ParsedTour } from '../types/tour';

const fullRegexPost = `Паттайя, 8 ночей
Вылет из: #Владивосток #Дальний_Восток
Даты: 15.03.26 - 23.03.26
Цена: 65700P
Бронировать: https://пртс.рф/c0g6`;

const usableRegexPost = `Рим
Вылет из: #Москва
21 мая 2026`;

const istanbulProsePost = `Стамбул (SAW) в мае 2026

из Москвы 21 мая 2026 на 12 ночей, прямой тур без пересадок.
Бронировать: https://example.com/istanbul`;

const beijingProsePost = `Пекин (PEK) в мае 2026

из Москвы 14 мая 2026 на 7 ночей, прямой тур без пересадок.
Бронировать: https://example.com/beijing`;

test('parseTour returns regex-only result with confidence 0.85 when fields are complete', async () => {
  const forbiddenLlmCall = async (): Promise<ParsedTour> => {
    throw new Error('LLM must not be called for complete regex parse');
  };

  const parsed = await parseTour(fullRegexPost, forbiddenLlmCall);
  assert.equal(parsed.destination, 'Паттайя');
  assert.equal(parsed.nights, 8);
  assert.deepEqual(parsed.departureCities, ['Владивосток', 'Дальний_Восток']);
  assert.equal(parsed.dateStart, '2026-03-15');
  assert.equal(parsed.dateEnd, '2026-03-23');
  assert.equal(parsed.price, 65700);
  assert.equal(parsed.bookingUrl, 'https://пртс.рф/c0g6');
  assert.equal(parsed.confidence, 0.85);
});

test('parseTour returns local regex result without LLM when destination, departure city, and dateStart are present', async () => {
  let llmCalls = 0;
  const forbiddenLlmCall = async (): Promise<ParsedTour> => {
    llmCalls += 1;
    throw new Error('LLM must not be called for usable local regex parse');
  };

  const parsed = await parseTour(usableRegexPost, forbiddenLlmCall);
  assert.equal(llmCalls, 0);
  assert.equal(parsed.destination, 'Рим');
  assert.deepEqual(parsed.departureCities, ['Москва']);
  assert.equal(parsed.dateStart, '2026-05-21');
  assert.equal(parsed.nights, undefined);
  assert.equal(parsed.dateEnd, undefined);
  assert.equal(parsed.price, undefined);
  assert.equal(parsed.confidence, 0.85);
});

test('parseTour keeps an Istanbul prose-style post with airport suffix and computed end date without LLM fallback', async () => {
  let llmCalls = 0;
  const forbiddenLlmCall = async (): Promise<ParsedTour> => {
    llmCalls += 1;
    throw new Error('LLM must not be called for usable local regex parse');
  };

  const parsed = await parseTour(istanbulProsePost, forbiddenLlmCall);
  assert.equal(llmCalls, 0);
  assert.equal(parsed.destination, 'Стамбул (SAW)');
  assert.deepEqual(parsed.departureCities, ['Москва']);
  assert.equal(parsed.dateStart, '2026-05-21');
  assert.equal(parsed.dateEnd, '2026-06-02');
  assert.equal(parsed.confidence, 0.85);
});

test('parseTour keeps a Beijing prose-style post with shorter stay and direct-flight wording without LLM fallback', async () => {
  let llmCalls = 0;
  const forbiddenLlmCall = async (): Promise<ParsedTour> => {
    llmCalls += 1;
    throw new Error('LLM must not be called for usable local regex parse');
  };

  const parsed = await parseTour(beijingProsePost, forbiddenLlmCall);
  assert.equal(llmCalls, 0);
  assert.equal(parsed.destination, 'Пекин (PEK)');
  assert.deepEqual(parsed.departureCities, ['Москва']);
  assert.equal(parsed.dateStart, '2026-05-14');
  assert.equal(parsed.dateEnd, '2026-05-21');
  assert.equal(parsed.confidence, 0.85);
});

test('parseTour falls back to LLM and merges regex fields over LLM values', async () => {
  const incompletePost = `Париж, 5 ночей
Цена: 12345P
Бронировать: https://example.com/tour`;

  const llmResult: ParsedTour = {
    destination: 'Paris',
    nights: 6,
    departureCities: ['Москва'],
    dateStart: '2026-04-01',
    dateEnd: '2026-04-07',
    price: 99999,
    bookingUrl: 'https://llm.example/tour',
    confidence: 0.62,
  };

  const parsed = await parseTour(incompletePost, async () => llmResult);
  assert.equal(parsed.destination, 'Париж');
  assert.equal(parsed.nights, 5);
  assert.equal(parsed.price, 12345);
  assert.equal(parsed.bookingUrl, 'https://example.com/tour');
  assert.deepEqual(parsed.departureCities, ['Москва']);
  assert.equal(parsed.dateStart, '2026-04-01');
  assert.equal(parsed.dateEnd, '2026-04-07');
  assert.equal(parsed.confidence, 0.7);
});
