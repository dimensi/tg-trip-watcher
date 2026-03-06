import { ParsedTour } from '../types/tour';

const DATE_RANGE_REGEX = /(\d{2}\.\d{2}\.\d{2,4})\s*[-–]\s*(\d{2}\.\d{2}\.\d{2,4})/;
const PRICE_REGEX = /(?:цена|стоимость)\s*[:\-]?\s*([\d\s]+)\s*[₽pр]/i;
const NIGHTS_REGEX = /(\d{1,2})\s*(?:ноч(?:ей|и|ь)|nights?)/i;
const URL_REGEX = /(https?:\/\/[^\s]+)/i;
const DEPARTURE_REGEX = /(?:вылет(?:\s+из)?|из\s*:)\s*([^\n]+)/i;

const normalizeDate = (value: string): string => {
  const parts = value.split('.');
  const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
  return `${year}-${parts[1]}-${parts[0]}`;
};

export const regexParseTour = (text: string): Partial<ParsedTour> => {
  const destination = text.split('\n')[0]?.split(',')[0]?.trim();
  const dateMatch = text.match(DATE_RANGE_REGEX);
  const nightsMatch = text.match(NIGHTS_REGEX);
  const priceMatch = text.match(PRICE_REGEX);
  const urlMatch = text.match(URL_REGEX);
  const departureMatch = text.match(DEPARTURE_REGEX);

  const departureCities = departureMatch
    ? departureMatch[1]
        .split(/[,#]/)
        .map((city) => city.trim().replace(/^#/, ''))
        .filter(Boolean)
    : [];

  return {
    destination,
    nights: nightsMatch ? Number(nightsMatch[1]) : undefined,
    departureCities,
    dateStart: dateMatch ? normalizeDate(dateMatch[1]) : undefined,
    dateEnd: dateMatch ? normalizeDate(dateMatch[2]) : undefined,
    price: priceMatch ? Number(priceMatch[1].replace(/\s/g, '')) : undefined,
    bookingUrl: urlMatch?.[1]
  };
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
