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
  assert.deepEqual(trace.results, [trace.result]);
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
  assert.equal(trace.results.length, 1);
  assert.deepEqual(trace.llm, llmResult);
  const direct = await parseTour(incompletePost, mockLlm);
  assert.deepEqual(trace.result, direct);
});

test('parseTourWithTrace: llm-merge with multiple LLM tours yields multiple merged results', async () => {
  const incompletePost = `Париж и Рим, туры
Цена: 12345P
Бронировать: https://example.com/tour`;

  const tourA: ParsedTour = {
    destination: 'Paris',
    nights: 5,
    departureCities: ['Москва'],
    dateStart: '2026-04-01',
    dateEnd: '2026-04-06',
    price: 10000,
    bookingUrl: 'https://llm.example/a',
    confidence: 0.7,
  };
  const tourB: ParsedTour = {
    destination: 'Rome',
    nights: 7,
    departureCities: ['Москва'],
    dateStart: '2026-05-01',
    dateEnd: '2026-05-08',
    price: 20000,
    bookingUrl: 'https://llm.example/b',
    confidence: 0.65,
  };

  const mockLlm = async (): Promise<ParsedTour[]> => [tourA, tourB];

  const trace = await parseTourWithTrace(incompletePost, mockLlm);
  assert.equal(trace.route, 'llm-merge');
  assert.equal(trace.results.length, 2);
  assert.equal(trace.llmTours?.length, 2);
  assert.deepEqual(trace.llm, tourA);
  assert.deepEqual(trace.llmTours, [tourA, tourB]);
  assert.deepEqual(trace.result, trace.results[0]);
  const direct = await parseTour(incompletePost, mockLlm);
  assert.deepEqual(direct, trace.results[0]);
});
