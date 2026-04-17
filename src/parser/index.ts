import { ParsedTour } from '../types/tour';
import { hasRequiredTourFields, hasUsableTourFields, regexParseTour } from './regexParser';
import { llmParseTour, llmParseTourWithRaw } from './llmParser';

export type ParseTourRoute = 'regex' | 'llm-merge';

export type ParseTourTrace = {
  route: ParseTourRoute;
  regex: ReturnType<typeof regexParseTour>;
  /** Parsed LLM JSON (after validation). Only when route is llm-merge. */
  llm?: ParsedTour;
  /** Raw message content from the model (same JSON string as parsed into `llm`). Only when route is llm-merge and the default OpenRouter parser was used. */
  llmRaw?: string;
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

  let llmResult: ParsedTour;
  let llmRaw: string | undefined;
  if (llmParser === llmParseTour) {
    const withRaw = await llmParseTourWithRaw(text);
    llmResult = withRaw.parsed;
    llmRaw = withRaw.rawContent;
  } else {
    llmResult = await llmParser(text);
  }
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
  return { route: 'llm-merge', regex: regexResult, llm: llmResult, llmRaw, result };
};

export const parseTour = async (
  text: string,
  llmParser: (input: string) => Promise<ParsedTour> = llmParseTour
): Promise<ParsedTour> => {
  const trace = await parseTourWithTrace(text, llmParser);
  return trace.result;
};
