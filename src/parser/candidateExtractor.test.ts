import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCandidates } from './candidateExtractor';

const hainanFreeFormPost = `Хайнань в мае 2026

Супер вылет из Москвы 21 мая 2026 на 12 ночей, прямой пакетный тур.
Сначала делимся подборкой и полезными ссылками:
https://t.me/vandroukitours/771
https://vandrouki.ru/hainan-may
https://example.com/hainan-note

Бронировать основной вариант:
https://агентство.рф/hainan-main
Еще отели и детали:
https://example.com/hainan-hotels

5* отели
Только отели без перелета и тура:
Даты: 14.05.26 - 21.05.26
Вылет из: Москва
https://vandroukitours.example/hotel-only`;

const shortBodyLinesPost = `Пхукет в ноябре 2026

Без визы
На 7 ночей
Вылет из: Москва
Даты: 10.11.26 - 17.11.26
https://example.com/phuket-main`;

const urlLedPost = `https://example.com/promo
https://example.com/another

Стамбул в мае 2026
Вылет из: Москва
Даты: 21.05.26 - 02.06.26
https://example.com/istanbul-main`;

const actionDateBodyPost = `Бали в июле 2026

Вылет 21 мая 2026
Заезд в июне 2026
Без визы
На 7 ночей
Даты: 21.05.26 - 28.05.26
https://example.com/bali-main`;

const preambledHainanPost = `Подборка от редакции

${hainanFreeFormPost}`;

test('extractCandidates splits a free-form post into multiple ordered blocks', () => {
  const candidates = extractCandidates(hainanFreeFormPost);

  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((candidate) => candidate.startLine), [1, 14]);
  assert.match(candidates[0].text, /^Хайнань в мае 2026\n\nСупер вылет из Москвы 21 мая 2026 на 12 ночей/m);
  assert.equal(candidates[0].text.includes('5* отели'), false);
  assert.match(candidates[1].text, /^5\* отели\nТолько отели без перелета и тура:/m);
});

test('extractCandidates keeps title lines with nearby departure and date details', () => {
  const candidates = extractCandidates(hainanFreeFormPost);

  assert.match(candidates[0].text, /^Хайнань в мае 2026\n\nСупер вылет из Москвы 21 мая 2026 на 12 ночей/m);
  assert.match(candidates[0].text, /Супер вылет из Москвы 21 мая 2026 на 12 ночей/);
  assert.match(candidates[0].text, /Бронировать основной вариант:/);
});

test('extractCandidates preserves a textual preamble before the first candidate', () => {
  const candidates = extractCandidates(preambledHainanPost);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].startLine, 1);
  assert.match(candidates[0].text, /^Подборка от редакции\n\nХайнань в мае 2026/m);
});

test('extractCandidates keeps short body lines inside the current candidate', () => {
  const candidates = extractCandidates(shortBodyLinesPost);

  assert.equal(candidates.length, 1);
  assert.match(candidates[0].text, /^Пхукет в ноябре 2026\n\nБез визы\nНа 7 ночей\nВылет из: Москва/m);
});

test('extractCandidates skips URL-led lines before the first real candidate', () => {
  const candidates = extractCandidates(urlLedPost);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].text.startsWith('Стамбул в мае 2026'), true);
  assert.equal(candidates[0].text.includes('https://example.com/promo'), false);
  assert.equal(candidates[0].text.includes('https://example.com/another'), false);
});

test('extractCandidates keeps date-bearing action lines inside the current candidate', () => {
  const candidates = extractCandidates(actionDateBodyPost);

  assert.equal(candidates.length, 1);
  assert.match(candidates[0].text, /^Бали в июле 2026\n\nВылет 21 мая 2026\nЗаезд в июне 2026\nБез визы\nНа 7 ночей/m);
});

test('extractCandidates drops bare URL lines from standalone candidates', () => {
  const candidates = extractCandidates(hainanFreeFormPost);

  assert.equal(candidates.some((candidate) => candidate.text.trim() === 'https://vandrouki.ru/hainan-may'), false);
  assert.equal(candidates.some((candidate) => candidate.text.trim() === 'https://example.com/hainan-note'), false);
  assert.equal(candidates.some((candidate) => candidate.text.trim() === 'https://агентство.рф/hainan-main'), false);
});
