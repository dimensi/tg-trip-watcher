import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDateEnd, parseNights, parseProseDate } from './dateParsing';

test('parseProseDate converts Russian month prose dates to ISO dates', () => {
  assert.equal(parseProseDate('24 марта 2026'), '2026-03-24');
  assert.equal(parseProseDate('21 мая 2026'), '2026-05-21');
  assert.equal(parseProseDate('12 мая 2026'), '2026-05-12');
});

test('parseProseDate rejects impossible calendar dates and unknown months', () => {
  assert.equal(parseProseDate('31 февраля 2026'), undefined);
  assert.equal(parseProseDate('12 марси 2026'), undefined);
});

test('computeDateEnd adds nights to a start date in UTC', () => {
  assert.equal(computeDateEnd('2026-05-21', 12), '2026-06-02');
  assert.equal(computeDateEnd('2026-03-24', 6), '2026-03-30');
});

test('computeDateEnd rejects malformed ISO input and boundary rollover still works', () => {
  assert.equal(computeDateEnd('2026-13-01', 2), undefined);
  assert.equal(computeDateEnd('not-an-iso-date', 2), undefined);
  assert.equal(computeDateEnd('2026-01-31', 1), '2026-02-01');
});

test('parseNights uses the first value from a night range', () => {
  assert.equal(parseNights('8-9 ночей'), 8);
  assert.equal(parseNights('12 ночей'), 12);
  assert.equal(parseNights('108-109 nights'), 108);
  assert.equal(parseNights('108 nights'), 108);
});

test('parseNights returns undefined when it cannot parse a night count', () => {
  assert.equal(parseNights('no nights here'), undefined);
  assert.equal(parseNights('room12 nights'), undefined);
});
