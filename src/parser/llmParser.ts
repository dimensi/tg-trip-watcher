import OpenAI from 'openai';
import pino from 'pino';
import { envConfig, getJsonConfig } from '../config';
import { ParsedTour } from '../types/tour';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'llm-parser' });

const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: envConfig.openRouterApiKey,
});

const buildPrompt = (text: string, maxChars: number): string =>
  `Extract a tour offer from text. Return strict JSON only with keys:
destination(string), nights(number), departureCities(string[]), dateStart(YYYY-MM-DD), dateEnd(YYYY-MM-DD), price(number), bookingUrl(string), confidence(number 0..1).
If uncertain, still return best guess and lower confidence.

Text:\n${text.slice(0, maxChars)}`;

const validateParsed = (value: Partial<ParsedTour>): ParsedTour => {
  if (
    !value.destination ||
    !value.nights ||
    !value.departureCities?.length ||
    !value.dateStart ||
    !value.dateEnd ||
    !value.price ||
    !value.bookingUrl
  ) {
    throw new Error('LLM response missing required fields');
  }
  return {
    destination: value.destination,
    nights: value.nights,
    departureCities: value.departureCities,
    dateStart: value.dateStart,
    dateEnd: value.dateEnd,
    price: value.price,
    bookingUrl: value.bookingUrl,
    confidence: value.confidence ?? 0.6,
  };
};

export const llmParseTour = async (text: string): Promise<ParsedTour> => {
  const cfg = getJsonConfig().openRouter;

  const response = await client.chat.completions.create({
    model: cfg.model,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    max_tokens: 500,
    messages: [
      { role: 'system', content: 'You are an accurate travel offer extractor. Return valid JSON only.' },
      { role: 'user', content: buildPrompt(text, cfg.maxInputChars) },
    ],
  }, {
    timeout: cfg.timeoutMs,
    maxRetries: cfg.maxRetries,
  });

  const usage = response.usage;
  logger.info({ usage }, 'OpenRouter usage');

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('OpenRouter returned empty content');
  }

  const parsed = JSON.parse(content) as Partial<ParsedTour>;
  return validateParsed(parsed);
};
