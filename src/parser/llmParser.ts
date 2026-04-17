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
  `Extract ONE tour offer from the message (Russian or English). Reply with ONE flat JSON object only — not an array, not wrapped in "tours"/"offers".

If the message lists several separate deals (different cities, dates, or links), choose exactly ONE: prefer the last block that clearly states destination, departure city, dates, price, and its own booking link. Ignore hotel-name-only lines without a full tour line.

Required keys (all must be present):
- destination: main resort/city name (string), no marketing fluff.
- nights: integer. If the text gives a range (e.g. "12-14 ночей"), pick ONE number (prefer the lower bound).
- departureCities: string array of departure cities (e.g. "из Москвы" → ["Москва"]; "Петербург"/СПб → ["Санкт-Петербург"]). Never leave empty if any city is mentioned.
- dateStart, dateEnd: YYYY-MM-DD. You should almost always set BOTH. If you have a start date and a night count, compute dateEnd as the calendar day of checkout after the last night (e.g. start 2026-05-27 + 14 nights → dateEnd is 2026-06-10). If the text gives an explicit date range, use those dates. Only skip dateEnd when neither nights nor any end/range date can be inferred at all.
- price: single integer in RUB (or stated currency as a number without symbols). If a range (e.g. 75900-76600), use the lower value.
- bookingUrl: the https URL that belongs to the same offer you chose (match city/dates to the right link).
- confidence: 0..1; lower when you had to guess dates, ranges, or missing details.

Rules: never omit required keys (destination, nights, departureCities, dateStart, price, bookingUrl, confidence). Always include dateEnd when you can derive it from the text (default: from dateStart + nights). Never use null for required fields.

Text:
${text.slice(0, maxChars)}`;

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);

/** OpenRouter sometimes returns an array of offers or { tours: [...] }; collapse to one Partial<ParsedTour>. */
export const normalizeLlmTourPayload = (raw: unknown): Partial<ParsedTour> => {
  if (raw === null || raw === undefined) {
    throw new Error('LLM returned empty JSON');
  }
  if (Array.isArray(raw)) {
    for (let i = raw.length - 1; i >= 0; i -= 1) {
      const x = raw[i];
      if (
        isPlainObject(x) &&
        (typeof x.destination === 'string' || typeof x.bookingUrl === 'string')
      ) {
        return x as Partial<ParsedTour>;
      }
    }
    throw new Error('LLM returned a JSON array without a usable tour object');
  }
  if (!isPlainObject(raw)) {
    throw new Error('LLM JSON must be an object');
  }
  for (const key of ['tours', 'offers', 'deals', 'results', 'items'] as const) {
    const arr = raw[key];
    if (Array.isArray(arr) && arr.length > 0) {
      const nested = normalizeLlmTourPayload(arr);
      if (nested && Object.keys(nested).length > 0) {
        return nested;
      }
    }
  }
  const tour = raw.tour;
  if (isPlainObject(tour)) {
    return tour as Partial<ParsedTour>;
  }
  return raw as Partial<ParsedTour>;
};

const stripMarkdownJsonFence = (content: string): string => {
  const t = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(t);
  if (fenced) {
    return fenced[1].trim();
  }
  return t;
};

const parseJsonLenient = (content: string): unknown => {
  const stripped = stripMarkdownJsonFence(content);
  try {
    return JSON.parse(stripped) as unknown;
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(stripped.slice(start, end + 1)) as unknown;
    }
    throw new Error('OpenRouter returned non-JSON content');
  }
};

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
    max_tokens: 1024,
    messages: [
      {
        role: 'system',
        content:
          'You extract structured tour offers for a search indexer. Output must be one flat JSON object (not an array). If the user message contains several offers, pick one offer per instructions. Every required field must be filled; infer conservatively and lower confidence when unsure.',
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

  const raw = parseJsonLenient(content);
  const parsed = normalizeLlmTourPayload(raw);
  return { parsed: validateParsed(parsed), rawContent: content };
};

export const llmParseTour = async (text: string): Promise<ParsedTour> => {
  const { parsed } = await llmParseTourWithRaw(text);
  return parsed;
};
