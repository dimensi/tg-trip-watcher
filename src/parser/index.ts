import { ParsedTour } from '../types/tour';
import { hasRequiredTourFields, regexParseTour } from './regexParser';
import { llmParseTour } from './llmParser';

export const parseTour = async (text: string): Promise<ParsedTour> => {
  const regexResult = regexParseTour(text);

  if (hasRequiredTourFields(regexResult)) {
    return {
      ...regexResult,
      confidence: 0.85
    };
  }

  const llmResult = await llmParseTour(text);
  return {
    ...llmResult,
    ...regexResult,
    departureCities: regexResult.departureCities?.length ? regexResult.departureCities : llmResult.departureCities,
    confidence: Math.max(llmResult.confidence, 0.7)
  };
};
