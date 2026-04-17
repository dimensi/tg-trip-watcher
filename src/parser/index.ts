import { ParsedTour } from '../types/tour';
import { hasRequiredTourFields, hasUsableTourFields, regexParseTour } from './regexParser';
import { llmParseTour } from './llmParser';

export type ParseTourRoute = 'regex' | 'llm-merge';

export type ParseTourTrace = {
  route: ParseTourRoute;
  regex: ReturnType<typeof regexParseTour>;
  llm?: ParsedTour;
  result: ParsedTour;
};

export const parseTourWithTrace = async (
  text: string,
  llmParser: (input: string) => Promise<ParsedTour> = llmParseTour
): Promise<ParseTourTrace> => {
  const regexResult = regexParseTour(text);

  if (hasRequiredTourFields(regexResult) || hasUsableTourFields(regexResult)) {
    const result: ParsedTour = {
      ...regexResult,
      confidence: 0.85,
    };
    return { route: 'regex', regex: regexResult, result };
  }

  const llmResult = await llmParser(text);
  const result: ParsedTour = {
    destination: regexResult.destination ?? llmResult.destination,
    nights: regexResult.nights ?? llmResult.nights,
    departureCities: regexResult.departureCities?.length ? regexResult.departureCities : llmResult.departureCities,
    dateStart: regexResult.dateStart ?? llmResult.dateStart,
    dateEnd: regexResult.dateEnd ?? llmResult.dateEnd,
    price: regexResult.price ?? llmResult.price,
    bookingUrl: regexResult.bookingUrl ?? llmResult.bookingUrl,
    confidence: Math.max(llmResult.confidence, 0.7),
  };
  return { route: 'llm-merge', regex: regexResult, llm: llmResult, result };
};

export const parseTour = async (
  text: string,
  llmParser: (input: string) => Promise<ParsedTour> = llmParseTour
): Promise<ParsedTour> => {
  const trace = await parseTourWithTrace(text, llmParser);
  return trace.result;
};
