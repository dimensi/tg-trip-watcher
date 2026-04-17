import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTour, parseTourWithTrace } from './index';
import { ParsedTour } from '../types/tour';

const fullRegexPost = `Паттайя, 8 ночей
Вылет из: #Владивосток #Дальний_Восток
Даты: 15.03.26 - 23.03.26
Цена: 65700P
Бронировать: https://пртс.рф/c0g6`;

test('parseTourWithTrace: regex route without LLM', async () => {
  const mockLlm = async (): Promise<ParsedTour> => {
    throw new Error('LLM must not be called');
  };
  const trace = await parseTourWithTrace(fullRegexPost, mockLlm);
  assert.equal(trace.route, 'regex');
  assert.equal(trace.result.confidence, 0.85);
  assert.equal(trace.llm, undefined);
  const direct = await parseTour(fullRegexPost, mockLlm);
  assert.deepEqual(trace.result, direct);
});

test('parseTourWithTrace: llm-merge route includes llm snapshot and matches parseTour merge', async () => {
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

  const mockLlm = async (): Promise<ParsedTour> => llmResult;

  const trace = await parseTourWithTrace(incompletePost, mockLlm);
  assert.equal(trace.route, 'llm-merge');
  assert.deepEqual(trace.llm, llmResult);
  const direct = await parseTour(incompletePost, mockLlm);
  assert.deepEqual(trace.result, direct);
});
