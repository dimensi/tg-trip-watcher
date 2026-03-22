import { extractCandidates } from './candidateExtractor';
import { computeDateEnd, parseNights, parseProseDate } from './dateParsing';
import { ParsedTour } from '../types/tour';

const DATE_RANGE_REGEX = /(\d{2}\.\d{2}\.\d{2,4})\s*[-–]\s*(\d{2}\.\d{2}\.\d{2,4})/;
const PRICE_REGEX = /(?:цена|стоимость)\s*[:\-]?\s*([\d\s]+)\s*[₽pр]/i;
const HOTEL_ONLY_REGEX = /\b(?:\d+\*\s*отели|только\s+отели|отели\s+без\s+(?:перелета|тура)|без\s+перелета(?:\s+и\s+тура)?|без\s+тура)\b/i;
const MONTH_WORD = '(?:январ[ьяе]|феврал[ьяе]|март[ае]?|апрел[ьяе]|ма[йяе]|июн[ьяе]|июл[ьяе]|август[ае]?|сентябр[ьяе]|октябр[ьяе]|ноябр[ьяе]|декабр[ьяе])';
const DATE_WORD_REGEX = new RegExp(`\\b${MONTH_WORD}\\s+\\d{4}\\b`, 'i');
const DATE_SUFFIX_REGEX = new RegExp(`\\s+(?:в|на)\\s+${MONTH_WORD}\\s+\\d{4}\\b.*$`, 'i');
const DAY_DATE_SUFFIX_REGEX = new RegExp(`\\s+\\d{1,2}\\s+${MONTH_WORD}\\s+\\d{4}\\b.*$`, 'i');
const NIGHT_SUFFIX_REGEX = /\s+\d{1,2}\s*(?:ноч(?:ей|и|ь)|nights?)\b.*$/i;
const DESTINATION_BLACKLIST = /\b(?:вылет|заезд|туры?|отель|отели|даты?|стоимость|цена|группа|подборк|бронировать|основной|полезн|подробност|сначала|пакетн|дешев|без\s+визы|в\s+одну\s+сторону|max\.ru|vk\.com|t\.me)\b/i;
const DESTINATION_LABEL_REGEX = /^[A-ZА-ЯЁ0-9]{2,}\s*:/;
const DATE_LINE_REGEX = /\b(?:\d{1,2}\.\d{1,2}\.\d{2,4}|\d{1,2}\s+[а-яё]+\s+\d{4})\b/i;
const DATE_LEADING_REGEX = /^(?:\d{1,2}\.\d{1,2}\.\d{2,4}|\d{1,2}\s+[а-яё]+\s+\d{4})\b/i;
const DATE_LABEL_REGEX = /^\s*даты?\s*:/i;
const URL_FIND_REGEX = /https?:\/\/[^\s]+/gi;
const OFFER_SPLIT_REGEX = /^\s*основн(?:ой\s+тур|ой\s+вариант)\s*:?\s*$/i;

const hasBookingHint = (value: string): boolean => /брон|подробнее|основн|вариант|ссылк|куп|оплат/i.test(value);
const hasStrongBookingHint = (value: string): boolean => /брон|основн|вариант|куп|оплат/i.test(value);

const normalizeDate = (value: string): string => {
  const parts = value.split('.');
  const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
  return `${year}-${parts[1]}-${parts[0]}`;
};

const cleanText = (value: string): string => value.trim().replace(/^[\s#,-]+|[\s.,;:!?-]+$/g, '').trim();

const normalizeCityName = (value: string): string => {
  const normalized = cleanText(value);
  const replacements: Record<string, string> = {
    'Москвы': 'Москва',
    'Москве': 'Москва',
    'Москву': 'Москва',
    'Самары': 'Самара',
    'Казани': 'Казань',
    'Самаре': 'Самара',
    'Самару': 'Самара',
    'Владивостока': 'Владивосток',
    'Владивостоке': 'Владивосток',
    'Хабаровска': 'Хабаровск',
    'Хабаровске': 'Хабаровск',
    'Пекина': 'Пекин',
    'Пекине': 'Пекин',
    'Стамбула': 'Стамбул',
    'Стамбуле': 'Стамбул',
    'Паттайи': 'Паттайя',
    'Аланьи': 'Аланья',
    'Хайнаня': 'Хайнань',
  };

  return replacements[normalized] ?? normalized;
};

const isPlausibleDestinationLine = (line: string): boolean => {
  const trimmed = line.trim();
  const lower = trimmed.toLowerCase();

  if (
    !trimmed ||
    /^\d+\*/.test(trimmed) ||
    trimmed.includes('#') ||
    DESTINATION_LABEL_REGEX.test(trimmed) ||
    HOTEL_ONLY_REGEX.test(trimmed) ||
    hasBookingHint(trimmed) ||
    lower.includes('подробност') ||
    lower.includes('вылет') ||
    lower === 'из' ||
    lower.startsWith('из ') ||
    PRICE_REGEX.test(trimmed) ||
    /^https?:\/\//i.test(trimmed) ||
    /https?:\/\//i.test(trimmed) ||
    trimmed.endsWith(':') ||
    DATE_LABEL_REGEX.test(trimmed) ||
    DATE_LEADING_REGEX.test(trimmed) ||
    DESTINATION_BLACKLIST.test(trimmed)
  ) {
    return false;
  }

  const tokenCount = trimmed.split(/\s+/).length;
  return tokenCount <= 5 || DATE_LINE_REGEX.test(trimmed);
};

const extractDestination = (text: string): string | undefined => {
  let destination: string | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  let nonEmptyLineIndex = 0;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    if (!isPlausibleDestinationLine(line)) {
      nonEmptyLineIndex += 1;
      continue;
    }

    let candidate = line.split(',')[0]?.trim() ?? line.trim();
    candidate = candidate.replace(DATE_SUFFIX_REGEX, '');
    candidate = candidate.replace(DAY_DATE_SUFFIX_REGEX, '');
    candidate = candidate.replace(NIGHT_SUFFIX_REGEX, '');
    candidate = candidate.replace(/\s+\d{4}\b.*$/i, '');

    const proseDateMatch = candidate.match(DATE_WORD_REGEX);
    if (proseDateMatch) {
      candidate = candidate.slice(0, proseDateMatch.index).replace(/\s+(?:в|на)\s*$/i, '').trim();
    }

    candidate = cleanText(candidate);
    if (candidate) {
      const score =
        (nonEmptyLineIndex === 0 ? 30 : 0) +
        (DATE_WORD_REGEX.test(line) || DATE_LINE_REGEX.test(line) ? 40 : 0) +
        (NIGHT_SUFFIX_REGEX.test(line) ? 20 : 0);

      if (score > bestScore) {
        destination = candidate;
        bestScore = score;
      }
    }

    nonEmptyLineIndex += 1;
  }

  return destination || undefined;
};

const extractDepartureCities = (text: string): string[] => {
  const cities = new Set<string>();
  let lastCities: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();
    let rawValue: string | undefined;

    const departureIndex = lower.indexOf('вылет');
    if (departureIndex >= 0) {
      rawValue = trimmed
        .slice(departureIndex + 'вылет'.length)
        .trimStart();
      if (rawValue.toLowerCase().startsWith('из')) {
        rawValue = rawValue.slice(2).trimStart();
        if (rawValue.startsWith(':')) {
          rawValue = rawValue.slice(1).trimStart();
        }
      }
    } else if (lower.startsWith('из')) {
      rawValue = trimmed.slice(2).trimStart();
      if (rawValue.startsWith(':')) {
        rawValue = rawValue.slice(1).trimStart();
      }
    }

    if (!rawValue) {
      continue;
    }

    const value = rawValue
      .replace(/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b.*$/i, '')
      .replace(/\b\d{1,2}\s+[а-яё]+\s+\d{4}\b.*$/i, '')
      .replace(/\b\d{1,2}\s*(?:ноч(?:ей|и|ь)|nights?)\b.*$/i, '')
      .replace(/\s+без\s+пересадок.*$/i, '')
      .replace(/\s+прямой\s+рейс.*$/i, '')
      .replace(/\s+с\s+багажом.*$/i, '')
      .replace(/\s+(?:без\s+пересадок|прямой\s+рейс|с\s+багажом)\b.*$/i, '');

    for (const part of value.split(/[,#]|\s+и\s+/i)) {
      const city = normalizeCityName(part.replace(/^#/, ''));
      if (city) {
        lastCities.push(city);
        cities.add(city);
      }
    }
  }

  return lastCities.length > 0 ? [...new Set(lastCities)] : [...cities];
};

const extractDateInfo = (
  text: string,
  nights: number | undefined
): { dateStart?: string; dateEnd?: string } => {
  let dateStart: string | undefined;
  let dateEnd: string | undefined;
  let hasExplicitRange = false;

  for (const line of text.split(/\r?\n/)) {
    const rangeMatch = line.match(DATE_RANGE_REGEX);
    if (rangeMatch) {
      dateStart = normalizeDate(rangeMatch[1]);
      dateEnd = normalizeDate(rangeMatch[2]);
      hasExplicitRange = true;
      continue;
    }

    if (hasExplicitRange) {
      continue;
    }

    const proseMatch = line.match(/\b\d{1,2}\s+[а-яё]+\s+\d{4}\b/i);
    if (!proseMatch) {
      continue;
    }

    const parsed = parseProseDate(proseMatch[0]);
    if (parsed) {
      dateStart = parsed;
      dateEnd = undefined;
    }
  }

  if (!hasExplicitRange && dateStart) {
    dateEnd = computeDateEnd(dateStart, nights);
  }

  return { dateStart, dateEnd };
};

const extractPrice = (text: string): number | undefined => {
  let price: number | undefined;

  for (const line of text.split(/\r?\n/)) {
    const priceMatch = line.match(PRICE_REGEX);
    if (priceMatch) {
      price = Number(priceMatch[1].replace(/\s/g, ''));
    }
  }

  return price;
};

const extractBookingUrl = (text: string): string | undefined => {
  const lines = text.split(/\r?\n/);
  const urls: Array<{ url: string; lineIndex: number; score: number }> = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const lineUrls = line.match(URL_FIND_REGEX) ?? [];
    const previousLine = lineIndex > 0 ? lines[lineIndex - 1] : '';
    const strongHint = hasStrongBookingHint(line) || hasStrongBookingHint(previousLine);
    const weakHint = hasBookingHint(line) || hasBookingHint(previousLine);

    for (const url of lineUrls) {
      urls.push({
        url,
        lineIndex,
        score: strongHint ? 100 : weakHint ? 50 : 0,
      });
    }
  }

  if (urls.length === 0) {
    return undefined;
  }

  let bestUrl = urls[0];

  for (const candidate of urls.slice(1)) {
    if (
      candidate.score > bestUrl.score ||
      (candidate.score === bestUrl.score && candidate.lineIndex < bestUrl.lineIndex)
    ) {
      bestUrl = candidate;
    }
  }

  return bestUrl.url;
};

const parseCandidate = (text: string): Partial<ParsedTour> => {
  const destination = extractDestination(text);
  const nights = parseNights(text);
  const departureCities = extractDepartureCities(text);
  const { dateStart, dateEnd } = extractDateInfo(text, nights);
  const price = extractPrice(text);
  const bookingUrl = extractBookingUrl(text);

  return {
    destination,
    nights,
    departureCities,
    dateStart,
    dateEnd,
    price,
    bookingUrl,
  };
};

const splitCandidateSegments = (text: string, startLine: number): Array<{ text: string; startLine: number }> => {
  const lines = text.split(/\r?\n/);
  const segments: Array<{ text: string; startLine: number }> = [];
  let currentLines: string[] = [];
  let currentStartLine = startLine;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (OFFER_SPLIT_REGEX.test(line)) {
      if (currentLines.length > 0) {
        segments.push({
          text: currentLines.join('\n').trimEnd(),
          startLine: currentStartLine,
        });
      }

      currentLines = [];
      currentStartLine = startLine + index + 2;
      continue;
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    segments.push({
      text: currentLines.join('\n').trimEnd(),
      startLine: currentStartLine,
    });
  }

  return segments;
};

const scoreCandidate = (candidate: Partial<ParsedTour>, text: string): number => {
  const hasDestination = candidate.destination ? 1 : 0;
  const departureScore = candidate.departureCities?.length ? 1 + Math.min(candidate.departureCities.length, 3) : 0;
  const hasDateStart = candidate.dateStart ? 1 : 0;
  const hasNights = candidate.nights ? 1 : 0;
  const hasBookingUrl = candidate.bookingUrl ? 1 : 0;
  const hasDateEnd = candidate.dateEnd ? 1 : 0;
  const hasPrice = candidate.price ? 1 : 0;
  const contextScore = hasDestination + departureScore + hasDateStart + hasNights;

  let score = hasDestination * 40 + departureScore * 30 + hasDateStart * 35 + hasNights * 10 + hasDateEnd * 5 + hasBookingUrl * 8 + hasPrice * 2;

  if (HOTEL_ONLY_REGEX.test(text)) {
    score -= 120;
  }

  if (hasPrice && contextScore <= 2) {
    score -= 20;
  }

  if (!hasBookingUrl) {
    score -= 5;
  }

  return score;
};

const pickBestCandidate = (text: string): Partial<ParsedTour> => {
  const segments = extractCandidates(text);
  const parsedSegments = segments.flatMap((segment) => splitCandidateSegments(segment.text, segment.startLine));

  if (parsedSegments.length === 0) {
    return parseCandidate(text);
  }

  let bestCandidate: Partial<ParsedTour> = {};
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestStartLine = Number.POSITIVE_INFINITY;

  for (const segment of parsedSegments) {
    const candidate = parseCandidate(segment.text);
    const score = scoreCandidate(candidate, segment.text);

    if (score > bestScore || (score === bestScore && segment.startLine < bestStartLine)) {
      bestCandidate = candidate;
      bestScore = score;
      bestStartLine = segment.startLine;
    }
  }

  return bestCandidate;
};

export const regexParseTour = (text: string): Partial<ParsedTour> => {
  return pickBestCandidate(text);
};

export const hasRequiredTourFields = (tour: Partial<ParsedTour>): tour is ParsedTour => {
  return Boolean(
    tour.destination &&
      tour.nights &&
      tour.departureCities &&
      tour.departureCities.length > 0 &&
      tour.dateStart &&
      tour.dateEnd &&
      tour.price &&
      tour.bookingUrl
  );
};

export const hasUsableTourFields = (
  tour: Partial<ParsedTour>
): tour is Pick<ParsedTour, 'destination' | 'departureCities' | 'dateStart'> & Partial<ParsedTour> => {
  return Boolean(tour.destination && tour.departureCities && tour.departureCities.length > 0 && tour.dateStart);
};
