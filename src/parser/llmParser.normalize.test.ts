import test from 'node:test';
import assert from 'node:assert/strict';
import { extractToursPartialsFromLlmJson, normalizeLlmTourPayload } from './llmParser';

test('normalizeLlmTourPayload: flat object unchanged', () => {
  const o = {
    destination: 'Пекин',
    nights: 9,
    departureCities: ['Москва'],
    dateStart: '2026-02-25',
    dateEnd: '2026-03-06',
    price: 61900,
    bookingUrl: 'https://vnd.im/rCMwT',
    confidence: 0.9,
  };
  assert.deepEqual(normalizeLlmTourPayload(o), o);
});

test('normalizeLlmTourPayload: array picks last tour-like object', () => {
  const a = { destination: 'Шанхай', bookingUrl: 'https://a' };
  const b = {
    destination: 'Пекин',
    nights: 9,
    departureCities: ['Москва'],
    dateStart: '2026-02-25',
    price: 61900,
    bookingUrl: 'https://b',
    confidence: 0.8,
  };
  const out = normalizeLlmTourPayload([a, b]);
  assert.equal(out.destination, 'Пекин');
  assert.equal(out.bookingUrl, 'https://b');
});

test('normalizeLlmTourPayload: unwraps tours key', () => {
  const inner = {
    destination: 'Пекин',
    nights: 9,
    departureCities: ['Москва'],
    dateStart: '2026-02-25',
    price: 61900,
    bookingUrl: 'https://x',
    confidence: 0.7,
  };
  const out = normalizeLlmTourPayload({ tours: [{ destination: 'X', bookingUrl: 'https://y' }, inner] });
  assert.equal(out.destination, 'Пекин');
});

test('extractToursPartialsFromLlmJson: returns all tours', () => {
  const a = { destination: 'Шанхай', bookingUrl: 'https://a' };
  const b = { destination: 'Пекин', bookingUrl: 'https://b' };
  const rows = extractToursPartialsFromLlmJson({ tours: [a, b] });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].destination, 'Шанхай');
  assert.equal(rows[1].destination, 'Пекин');
});
