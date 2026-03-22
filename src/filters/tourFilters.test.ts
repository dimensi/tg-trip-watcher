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
  arrivalCities: [],
  dateFrom: '2026-04-01',
  dateTo: '2026-05-01',
};

const istanbulParsedTour: ParsedTour = {
  destination: 'Стамбул (SAW)',
  nights: 12,
  departureCities: ['Москва'],
  dateStart: '2026-05-21',
  dateEnd: '2026-06-02',
  price: 62000,
  bookingUrl: 'https://example.com/istanbul',
  confidence: 0.85,
};

const beijingParsedTour: ParsedTour = {
  destination: 'Пекин (PEK)',
  nights: 7,
  departureCities: ['Москва'],
  dateStart: '2026-05-14',
  dateEnd: '2026-05-21',
  price: 54000,
  bookingUrl: 'https://example.com/beijing',
  confidence: 0.85,
};

test('matchesFilters rejects tours when dateEnd is outside configured range', () => {
  assert.equal(matchesFilters(baseTour, baseFilters), false);
});

test('matchesFilters accepts tours when dateStart is in range and dateEnd is missing', () => {
  const partialDateTour: ParsedTour = {
    ...baseTour,
    dateEnd: undefined,
  };

  assert.equal(matchesFilters(partialDateTour, baseFilters), true);
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

  const noPriceTour: ParsedTour = { ...inRangeTour, price: undefined };
  assert.equal(matchesFilters(noPriceTour, okFilters), false);
});

test('matchesFilters applies minNights and maxNights filters', () => {
  const tooShort: ParsedTour = { ...baseTour, nights: 4, dateEnd: '2026-05-01' };
  const tooLong: ParsedTour = { ...baseTour, nights: 12, dateEnd: '2026-05-01' };
  const filters: TourFilters = { ...baseFilters, minNights: 5, maxNights: 10 };

  assert.equal(matchesFilters(tooShort, filters), false);
  assert.equal(matchesFilters(tooLong, filters), false);
  assert.equal(matchesFilters({ ...baseTour, nights: 7, dateEnd: '2026-05-01' }, filters), true);
  assert.equal(matchesFilters({ ...baseTour, nights: undefined, dateEnd: '2026-05-01' }, filters), false);
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
    arrivalCities: [],
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

test('matchesFilters skips arrival city check when filter list is empty', () => {
  const filters: TourFilters = {
    ...baseFilters,
    arrivalCities: [],
  };
  const inRangeTour: ParsedTour = {
    ...baseTour,
    destination: 'Стамбул (SAW)',
    dateEnd: '2026-05-01',
  };
  assert.equal(matchesFilters(inRangeTour, filters), true);
});

test('matchesFilters applies arrival city filter with case-insensitive partial matching', () => {
  const filters: TourFilters = {
    ...baseFilters,
    arrivalCities: ['стамбул'],
  };
  const inRangeTour: ParsedTour = {
    ...baseTour,
    destination: 'Стамбул (SAW)',
    dateEnd: '2026-05-01',
  };
  assert.equal(matchesFilters(inRangeTour, filters), true);
});

test('matchesFilters rejects tours when none of arrival cities match destination', () => {
  const filters: TourFilters = {
    ...baseFilters,
    arrivalCities: ['Анталья'],
  };
  const inRangeTour: ParsedTour = {
    ...baseTour,
    destination: 'Стамбул',
    dateEnd: '2026-05-01',
  };
  assert.equal(matchesFilters(inRangeTour, filters), false);
});

test('matchesFilters keeps an Istanbul-style parsed tour when arrival and departure filters match', () => {
  const matchingFilters: TourFilters = {
    departureCities: ['Москва'],
    arrivalCities: ['стамбул'],
    dateFrom: '2026-05-01',
    dateTo: '2026-06-30',
  };

  const wrongDepartureFilters: TourFilters = {
    ...matchingFilters,
    departureCities: ['Казань'],
  };

  assert.equal(matchesFilters(istanbulParsedTour, matchingFilters), true);
  assert.equal(matchesFilters(istanbulParsedTour, wrongDepartureFilters), false);
});

test('matchesFilters keeps a Beijing-style parsed tour when arrival and departure filters match', () => {
  const matchingFilters: TourFilters = {
    departureCities: ['Москва'],
    arrivalCities: ['пекин'],
    dateFrom: '2026-05-01',
    dateTo: '2026-06-30',
  };

  const wrongDepartureFilters: TourFilters = {
    ...matchingFilters,
    departureCities: ['Санкт-Петербург'],
  };

  assert.equal(matchesFilters(beijingParsedTour, matchingFilters), true);
  assert.equal(matchesFilters(beijingParsedTour, wrongDepartureFilters), false);
});
