import { ParsedTour } from '../types/tour';
import { hasRequiredTourFields, hasUsableTourFields, regexParseTour } from './regexParser';
import { llmParseTour, llmParseToursWithRaw } from './llmParser';

export type ParseTourRoute = 'regex' | 'llm-merge';

export type ParseTourTrace = {
  route: ParseTourRoute;
  regex: ReturnType<typeof regexParseTour>;
  /** First LLM tour (debug). */
  llm?: ParsedTour;
  /** All LLM tours before merge with regex. */
  llmTours?: ParsedTour[];
  llmRaw?: string;
  /** First merged result (same as first of `results`). */
  result: ParsedTour;
  /** All merged tours (regex path: one element). */
  results: ParsedTour[];
};

const mergeLlmFirst = (regexResult: ReturnType<typeof regexParseTour>, llmResult: ParsedTour): ParsedTour => ({
  destination: (llmResult.destination ?? regexResult.destination) as string,
  nights: llmResult.nights ?? regexResult.nights,
  departureCities: llmResult.departureCities?.length
    ? llmResult.departureCities
    : (regexResult.departureCities ?? []),
  dateStart: llmResult.dateStart ?? regexResult.dateStart,
  dateEnd: llmResult.dateEnd ?? regexResult.dateEnd,
  price: llmResult.price ?? regexResult.price,
  bookingUrl: llmResult.bookingUrl ?? regexResult.bookingUrl,
  confidence: Math.max(llmResult.confidence, 0.7),
});

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
    return { route: 'regex', regex: regexResult, result, results: [result] };
  }

  let llmTours: ParsedTour[];
  let llmRaw: string | undefined;

  if (llmParser === llmParseTour) {
    const w = await llmParseToursWithRaw(text);
    llmTours = w.tours;
    llmRaw = w.rawContent;
  } else {
    llmTours = [await llmParser(text)];
  }

  const results = llmTours.map((llmResult) => mergeLlmFirst(regexResult, llmResult));
  return {
    route: 'llm-merge',
    regex: regexResult,
    llm: llmTours[0],
    llmTours,
    llmRaw,
    result: results[0],
    results,
  };
};

/** All tours found in the message (regex: at most one; LLM: one per distinct offer). */
export const parseTours = async (
  text: string,
  llmParser: (input: string) => Promise<ParsedTour> = llmParseTour
): Promise<ParsedTour[]> => {
  const trace = await parseTourWithTrace(text, llmParser);
  return trace.results;
};

export const parseTour = async (
  text: string,
  llmParser: (input: string) => Promise<ParsedTour> = llmParseTour
): Promise<ParsedTour> => {
  const trace = await parseTourWithTrace(text, llmParser);
  return trace.result;
};
