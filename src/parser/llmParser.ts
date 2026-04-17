import OpenAI from 'openai';
import pino from 'pino';
import { getJsonConfig } from '../config/jsonConfig';
import { ParsedTour } from '../types/tour';
import { computeDateEnd } from './dateParsing';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'llm-parser' });

const MAX_TOURS_PER_MESSAGE = 20;

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

const buildPromptMulti = (text: string, maxChars: number): string =>
  `Extract tour offers from the message (Russian or English). Reply with ONE JSON object only, no markdown.

Shape: { "tours": [ { ... }, ... ] }
- "tours" is a non-empty array. Each element is one distinct offer (different destination and/or dates and/or price and/or link).
- If the message describes only one tour, use a single element.
- Ignore hotel-only lines (e.g. "Radisson 5*") that are not a full separate tour line with destination and dates.
- Each tour object must have the same keys and rules as below.

Per tour fields (all required for each object):
- destination: main resort/city name (string), no marketing fluff.
- nights: integer. If the text gives a range (e.g. "5-6 ночей"), pick ONE number (prefer the lower bound).
- departureCities: string array (e.g. "из Москвы" → ["Москва"]; СПб → ["Санкт-Петербург"]). Never empty if a city is mentioned for that offer.
- dateStart: YYYY-MM-DD. dateEnd: same format when inferable; if you have start + nights, set dateEnd = checkout day after the last night. Prefer correct year when the text implies it.
- price: single integer. If a range, use the lower value.
- bookingUrl: the https URL that belongs to that same offer (match destination/dates to the correct link).
- confidence: 0..1 per offer.

Rules: never omit required keys inside each tour. Never use null for required fields. Use best inference and lower confidence when unsure.

Text:
${text.slice(0, maxChars)}`;

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);

/** @deprecated Prefer extractToursPartialsFromLlmJson for multi-tour responses. */
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

export const extractToursPartialsFromLlmJson = (raw: unknown): Partial<ParsedTour>[] => {
  if (raw === null || raw === undefined) {
    throw new Error('LLM returned empty JSON');
  }
  if (Array.isArray(raw)) {
    const rows = raw.filter(isPlainObject) as Partial<ParsedTour>[];
    if (rows.length === 0) {
      throw new Error('LLM returned an empty array');
    }
    return rows;
  }
  if (!isPlainObject(raw)) {
    throw new Error('LLM JSON must be an object or array');
  }
  for (const key of ['tours', 'offers', 'deals', 'results', 'items'] as const) {
    const arr = raw[key];
    if (Array.isArray(arr) && arr.length > 0) {
      return arr.filter(isPlainObject) as Partial<ParsedTour>[];
    }
  }
  if (typeof raw.destination === 'string' || typeof raw.bookingUrl === 'string') {
    return [raw as Partial<ParsedTour>];
  }
  throw new Error('LLM JSON must contain a non-empty "tours" array or a single tour object');
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

export type LlmParseToursWithRawResult = {
  tours: ParsedTour[];
  rawContent: string;
};

export const llmParseToursWithRaw = async (text: string): Promise<LlmParseToursWithRawResult> => {
  const cfg = getJsonConfig().openRouter;

  const response = await getOpenRouterClient().chat.completions.create({
    model: cfg.model,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    max_tokens: 4096,
    messages: [
      {
        role: 'system',
        content:
          'You extract structured tour offers. Output must be one JSON object with a top-level "tours" array. Each tour must include every required field. If a message contains several distinct offers, list each as a separate object in "tours".',
      },
      { role: 'user', content: buildPromptMulti(text, cfg.maxInputChars) },
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
  const partials = extractToursPartialsFromLlmJson(raw);
  const capped = partials.slice(0, MAX_TOURS_PER_MESSAGE);
  const tours = capped.map((p, i) => {
    try {
      return validateParsed(p);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Tour ${i + 1}: ${msg}`);
    }
  });
  if (tours.length === 0) {
    throw new Error('LLM returned no valid tours');
  }
  return { tours, rawContent: content };
};

export const llmParseTours = async (text: string): Promise<ParsedTour[]> => {
  const { tours } = await llmParseToursWithRaw(text);
  return tours;
};

export type LlmParseWithRawResult = {
  parsed: ParsedTour;
  rawContent: string;
};

export const llmParseTourWithRaw = async (text: string): Promise<LlmParseWithRawResult> => {
  const { tours, rawContent } = await llmParseToursWithRaw(text);
  return { parsed: tours[0], rawContent };
};

export const llmParseTour = async (text: string): Promise<ParsedTour> => {
  const { parsed } = await llmParseTourWithRaw(text);
  return parsed;
};
