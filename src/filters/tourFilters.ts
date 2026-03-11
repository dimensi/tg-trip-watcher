import { ParsedTour, TourFilters } from '../types/tour';

const inRange = (value: string, from?: string, to?: string): boolean => {
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
};

export const matchesFilters = (tour: ParsedTour, filters: TourFilters): boolean => {
  if (filters.maxPrice !== undefined && tour.price > filters.maxPrice) {
    return false;
  }

  if (filters.minNights !== undefined && tour.nights < filters.minNights) {
    return false;
  }

  if (filters.maxNights !== undefined && tour.nights > filters.maxNights) {
    return false;
  }

  if (!inRange(tour.dateStart, filters.dateFrom, filters.dateTo)) {
    return false;
  }

  if (!inRange(tour.dateEnd, filters.dateFrom, filters.dateTo)) {
    return false;
  }

  if (filters.departureCities.length > 0) {
    const normalizedAllowed = filters.departureCities.map((city) => city.toLowerCase());
    const hasAllowed = tour.departureCities.some((city) => normalizedAllowed.includes(city.toLowerCase()));
    if (!hasAllowed) {
      return false;
    }
  }

  return true;
};
