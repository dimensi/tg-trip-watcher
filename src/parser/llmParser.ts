import pino from 'pino';
import { config } from '../config';
import { ParsedTour } from '../types/tour';

const logger = pino({ level: config.app.logLevel }).child({ module: 'llm-parser' });

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
}

interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: OpenRouterUsage;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const buildPrompt = (text: string): string => `Extract a tour offer from text. Return strict JSON only with keys:
destination(string), nights(number), departureCities(string[]), dateStart(YYYY-MM-DD), dateEnd(YYYY-MM-DD), price(number), bookingUrl(string), confidence(number 0..1).
If uncertain, still return best guess and lower confidence.

Text:\n${text.slice(0, config.openRouter.maxInputChars)}`;

const validateParsed = (value: Partial<ParsedTour>): ParsedTour => {
  if (!value.destination || !value.nights || !value.departureCities?.length || !value.dateStart || !value.dateEnd || !value.price || !value.bookingUrl) {
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
    confidence: value.confidence ?? 0.6
  };
};

export const llmParseTour = async (text: string): Promise<ParsedTour> => {
  let lastError: unknown = new Error('Unknown OpenRouter error');

  for (let attempt = 1; attempt <= config.openRouter.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.openRouter.timeoutMs);

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${config.openRouter.apiKey}`,
          'Content-Type': 'application/json',
          ...(config.openRouter.siteUrl ? { 'HTTP-Referer': config.openRouter.siteUrl } : {}),
          ...(config.openRouter.siteName ? { 'X-Title': config.openRouter.siteName } : {})
        },
        body: JSON.stringify({
          model: config.openRouter.model,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: 'You are an accurate travel offer extractor. Return valid JSON only.'
            },
            {
              role: 'user',
              content: buildPrompt(text)
            }
          ],
          temperature: 0.1
        })
      });

      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`OpenRouter HTTP ${response.status}: ${await response.text()}`);
      }

      const payload = (await response.json()) as OpenRouterResponse;
      const usage = payload.usage;

      if (usage?.cost && usage.cost > config.openRouter.maxCostUsd) {
        throw new Error(`OpenRouter request cost exceeded limit: ${usage.cost}`);
      }

      logger.info({ usage }, 'OpenRouter usage');

      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('OpenRouter returned empty content');
      }

      const parsed = JSON.parse(content) as Partial<ParsedTour>;
      return validateParsed(parsed);
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      logger.warn({ attempt, err: error }, 'OpenRouter request failed, retrying');
      await wait(attempt * 500);
    }
  }

  throw lastError;
};
