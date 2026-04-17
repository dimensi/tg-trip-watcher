import OpenAI from 'openai';
import pino from 'pino';
import { getJsonConfig } from '../config/jsonConfig';
import { ParsedTour } from '../types/tour';
import { computeDateEnd } from './dateParsing';

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
  `Extract a single tour offer from the message (Russian or English). Reply with ONE JSON object only, no markdown.

Required keys (all must be present):
- destination: main resort/city name (string), no marketing fluff.
- nights: integer. If the text gives a range (e.g. "12-14 ночей"), pick ONE number (prefer the lower bound).
- departureCities: string array of departure cities (e.g. "из Москвы" → ["Москва"]; "Петербург"/СПб → ["Санкт-Петербург"]). Never leave empty if any city is mentioned.
- dateStart, dateEnd: YYYY-MM-DD. You should almost always set BOTH. If you have a start date and a night count, compute dateEnd as the calendar day of checkout after the last night (e.g. start 2026-05-27 + 14 nights → dateEnd is 2026-06-10). If the text gives an explicit date range, use those dates. Only skip dateEnd when neither nights nor any end/range date can be inferred at all.
- price: single integer in RUB (or stated currency as a number without symbols). If a range (e.g. 75900-76600), use the lower value.
- bookingUrl: one https URL from the text; if several, prefer the booking/tour link.
- confidence: 0..1; lower when you had to guess dates, ranges, or missing details.

Rules: never omit required keys (destination, nights, departureCities, dateStart, price, bookingUrl, confidence). Always include dateEnd when you can derive it from the text (default: from dateStart + nights). Never use null for required fields.

Text:
${text.slice(0, maxChars)}`;

const validateParsed = (value: Partial<ParsedTour>): ParsedTour => {
  const missing: string[] = [];
  if (!value.destination) missing.push('destination');
  if (value.nights === undefined || value.nights === null) missing.push('nights');
  if (!value.departureCities?.length) missing.push('departureCities');
  if (!value.dateStart) missing.push('dateStart');
  if (value.price === undefined || value.price === null) missing.push('price');
  if (!value.bookingUrl) missing.push('bookingUrl');
  if (missing.length > 0) {
    throw new Error(`LLM response missing required fields: ${missing.join(', ')}`);
  }
  const v = value as ParsedTour;
  const inferredDateEnd =
    v.dateEnd ??
    (v.dateStart && v.nights !== undefined ? computeDateEnd(v.dateStart, v.nights) : undefined);
  return {
    ...v,
    confidence: v.confidence ?? 0.6,
    dateEnd: inferredDateEnd ?? undefined,
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
      {
        role: 'system',
        content:
          'You extract structured tour offers for a search indexer. Output is a single JSON object; every required field must always be filled; infer conservatively and lower confidence when unsure.',
      },
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
