import OpenAI from 'openai';
import pino from 'pino';
import { getJsonConfig } from '../config/jsonConfig';
import { ParsedTour } from '../types/tour';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'llm-parser' });

let client: OpenAI | null = null;

const getOpenRouterClient = (): OpenAI => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENROUTER_API_KEY');
  }
  if (!client) {
    client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
    });
  }
  return client;
};

const buildPrompt = (text: string, maxChars: number): string =>
  `Extract a tour offer from text. Return strict JSON only with keys:
destination(string), nights(number), departureCities(string[]), dateStart(YYYY-MM-DD), dateEnd(YYYY-MM-DD), price(number), bookingUrl(string), confidence(number 0..1).
If uncertain, still return best guess and lower confidence.

Text:\n${text.slice(0, maxChars)}`;

const validateParsed = (value: Partial<ParsedTour>): ParsedTour => {
  const missing: string[] = [];
  if (!value.destination) missing.push('destination');
  if (value.nights === undefined || value.nights === null) missing.push('nights');
  if (!value.departureCities?.length) missing.push('departureCities');
  if (!value.dateStart) missing.push('dateStart');
  if (!value.dateEnd) missing.push('dateEnd');
  if (value.price === undefined || value.price === null) missing.push('price');
  if (!value.bookingUrl) missing.push('bookingUrl');
  if (missing.length > 0) {
    throw new Error(`LLM response missing required fields: ${missing.join(', ')}`);
  }
  const v = value as ParsedTour;
  return {
    ...v,
    confidence: v.confidence ?? 0.6,
  };
};

export type LlmParseWithRawResult = {
  parsed: ParsedTour;
  /** Message content string from the API (before JSON.parse). */
  rawContent: string;
};

export const llmParseTourWithRaw = async (text: string): Promise<LlmParseWithRawResult> => {
  const cfg = getJsonConfig().openRouter;

  const response = await getOpenRouterClient().chat.completions.create({
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

  const usage = response.usage as (typeof response.usage & { cost?: number }) | null;
  logger.info({ usage }, 'OpenRouter usage');

  if (usage?.cost !== undefined && usage.cost > cfg.maxCostUsd) {
    throw new Error(`OpenRouter request cost ${usage.cost} exceeded limit ${cfg.maxCostUsd}`);
  }

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('OpenRouter returned empty content');
  }

  const parsed = JSON.parse(content) as Partial<ParsedTour>;
  return { parsed: validateParsed(parsed), rawContent: content };
};

export const llmParseTour = async (text: string): Promise<ParsedTour> => {
  const { parsed } = await llmParseTourWithRaw(text);
  return parsed;
};
