import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesFilters } from './tourFilters';
import { ParsedTour, TourFilters } from '../types/tour';

const baseTour: ParsedTour = {
  destination: 'Test',
  nights: 7,
  departureCities: ['Москва'],
  dateStart: '2026-04-20',
  dateEnd: '2026-05-05',
  price: 50000,
  bookingUrl: 'https://example.com',
  confidence: 0.9,
};

const baseFilters: TourFilters = {
  departureCities: [],
  dateFrom: '2026-04-01',
  dateTo: '2026-05-01',
};

test('matchesFilters rejects tours when dateEnd is outside configured range', () => {
  assert.equal(matchesFilters(baseTour, baseFilters), false);
});

test('matchesFilters accepts tours when both dateStart and dateEnd are in range', () => {
  const inRangeTour: ParsedTour = {
    ...baseTour,
    dateEnd: '2026-05-01',
  };
  assert.equal(matchesFilters(inRangeTour, baseFilters), true);
});

test('matchesFilters applies maxPrice filter', () => {
  const strictFilters: TourFilters = { ...baseFilters, maxPrice: 49000 };
  assert.equal(matchesFilters(baseTour, strictFilters), false);

  const okFilters: TourFilters = { ...baseFilters, maxPrice: 50000 };
  const inRangeTour: ParsedTour = { ...baseTour, dateEnd: '2026-05-01' };
  assert.equal(matchesFilters(inRangeTour, okFilters), true);
});

test('matchesFilters applies minNights and maxNights filters', () => {
  const tooShort: ParsedTour = { ...baseTour, nights: 4, dateEnd: '2026-05-01' };
  const tooLong: ParsedTour = { ...baseTour, nights: 12, dateEnd: '2026-05-01' };
  const filters: TourFilters = { ...baseFilters, minNights: 5, maxNights: 10 };

  assert.equal(matchesFilters(tooShort, filters), false);
  assert.equal(matchesFilters(tooLong, filters), false);
  assert.equal(matchesFilters({ ...baseTour, nights: 7, dateEnd: '2026-05-01' }, filters), true);
});

test('matchesFilters treats date boundaries as inclusive for start and end', () => {
  const boundaryTour: ParsedTour = {
    ...baseTour,
    dateStart: '2026-04-01',
    dateEnd: '2026-05-01',
  };
  assert.equal(matchesFilters(boundaryTour, baseFilters), true);
});

test('matchesFilters rejects tours when dateStart is outside configured range', () => {
  const outOfRangeStart: ParsedTour = {
    ...baseTour,
    dateStart: '2026-03-31',
    dateEnd: '2026-04-10',
  };
  assert.equal(matchesFilters(outOfRangeStart, baseFilters), false);
});

test('matchesFilters skips departure city check when filter list is empty', () => {
  const filters: TourFilters = {
    ...baseFilters,
    departureCities: [],
  };
  const inRangeTour: ParsedTour = {
    ...baseTour,
    departureCities: ['Неважно'],
    dateEnd: '2026-05-01',
  };
  assert.equal(matchesFilters(inRangeTour, filters), true);
});

test('matchesFilters applies departure city filter case-insensitively', () => {
  const filters: TourFilters = {
    ...baseFilters,
    departureCities: ['мОсква', 'Казань'],
  };
  const inRangeTour: ParsedTour = {
    ...baseTour,
    departureCities: ['МОСКВА'],
    dateEnd: '2026-05-01',
  };
  assert.equal(matchesFilters(inRangeTour, filters), true);
});

test('matchesFilters rejects tours when none of departure cities match', () => {
  const filters: TourFilters = {
    ...baseFilters,
    departureCities: ['Казань', 'Пермь'],
  };
  const inRangeTour: ParsedTour = {
    ...baseTour,
    departureCities: ['Москва'],
    dateEnd: '2026-05-01',
  };
  assert.equal(matchesFilters(inRangeTour, filters), false);
});

test('matchesFilters returns true when all active filters pass together', () => {
  const filters: TourFilters = {
    maxPrice: 70000,
    departureCities: ['Москва'],
    minNights: 5,
    maxNights: 9,
    dateFrom: '2026-04-01',
    dateTo: '2026-05-01',
  };

  const tour: ParsedTour = {
    ...baseTour,
    dateStart: '2026-04-20',
    dateEnd: '2026-04-27',
    nights: 7,
    price: 50000,
    departureCities: ['Москва', 'СПб'],
  };

  assert.equal(matchesFilters(tour, filters), true);
});
