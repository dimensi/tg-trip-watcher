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
  // LLM-first: we only called the model because regex was not usable alone; trust LLM and fill gaps from regex.
  const result: ParsedTour = {
    destination: llmResult.destination ?? regexResult.destination,
    nights: llmResult.nights ?? regexResult.nights,
    departureCities:
      llmResult.departureCities?.length ? llmResult.departureCities : (regexResult.departureCities ?? []),
    dateStart: llmResult.dateStart ?? regexResult.dateStart,
    dateEnd: llmResult.dateEnd ?? regexResult.dateEnd,
    price: llmResult.price ?? regexResult.price,
    bookingUrl: llmResult.bookingUrl ?? regexResult.bookingUrl,
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
