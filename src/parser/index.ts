import { ParsedTour } from '../types/tour';
import { hasRequiredTourFields, regexParseTour } from './regexParser';
import { llmParseTour } from './llmParser';

export const parseTour = async (
  text: string,
  llmParser: (input: string) => Promise<ParsedTour> = llmParseTour
): Promise<ParsedTour> => {
  const regexResult = regexParseTour(text);

  if (hasRequiredTourFields(regexResult)) {
    return {
      ...regexResult,
      confidence: 0.85
    };
  }

  const llmResult = await llmParser(text);
  return {
    destination: regexResult.destination ?? llmResult.destination,
    nights: regexResult.nights ?? llmResult.nights,
    departureCities: regexResult.departureCities?.length ? regexResult.departureCities : llmResult.departureCities,
    dateStart: regexResult.dateStart ?? llmResult.dateStart,
    dateEnd: regexResult.dateEnd ?? llmResult.dateEnd,
    price: regexResult.price ?? llmResult.price,
    bookingUrl: regexResult.bookingUrl ?? llmResult.bookingUrl,
    confidence: Math.max(llmResult.confidence, 0.7)
  };
};
