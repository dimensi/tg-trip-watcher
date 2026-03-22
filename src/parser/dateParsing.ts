const MONTHS: Record<string, number> = {
  'января': 0,
  'февраля': 1,
  'марта': 2,
  'апреля': 3,
  'мая': 4,
  'июня': 5,
  'июля': 6,
  'августа': 7,
  'сентября': 8,
  'октября': 9,
  'ноября': 10,
  'декабря': 11,
};

const PROSE_DATE_REGEX = /^(\d{1,2})\s+([а-яё]+)\s+(\d{4})$/i;
const NIGHTS_REGEX = /(\d{1,3})(?:\s*-\s*\d{1,3})?\s*(?:ноч(?:ей|и|ь)|nights?)/giu;
const ISO_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

const isValidUtcDate = (year: number, month: number, day: number): boolean => {
  const candidate = new Date(Date.UTC(year, month, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month &&
    candidate.getUTCDate() === day
  );
};

const hasLeadingBoundary = (value: string, index: number): boolean => {
  if (index === 0) {
    return true;
  }

  const previousChar = value[index - 1];
  return !/[\p{L}\p{N}]/u.test(previousChar);
};

export const parseProseDate = (value: string): string | undefined => {
  const match = value.trim().match(PROSE_DATE_REGEX);
  if (!match) {
    return undefined;
  }

  const day = Number(match[1]);
  const month = MONTHS[match[2].toLowerCase()];
  const year = Number(match[3]);

  if (month === undefined || Number.isNaN(day) || Number.isNaN(year)) {
    return undefined;
  }

  if (!isValidUtcDate(year, month, day)) {
    return undefined;
  }

  return toIsoDate(new Date(Date.UTC(year, month, day)));
};

export const computeDateEnd = (dateStart: string, nights: number | undefined): string | undefined => {
  const match = dateStart.match(ISO_DATE_REGEX);
  if (!match || typeof nights !== 'number' || !Number.isInteger(nights) || nights < 0) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);

  if (!isValidUtcDate(year, month, day)) {
    return undefined;
  }

  const end = new Date(Date.UTC(year, month, day));
  end.setUTCDate(end.getUTCDate() + nights);
  return toIsoDate(end);
};

export const parseNights = (value: string): number | undefined => {
  for (const match of value.matchAll(NIGHTS_REGEX)) {
    if (match.index !== undefined && hasLeadingBoundary(value, match.index)) {
      return Number(match[1]);
    }
  }

  return undefined;
};
