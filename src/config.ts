import dotenv from 'dotenv';

dotenv.config();

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const optionalNumber = (name: string): number | undefined => {
  const value = process.env[name];
  if (!value) return undefined;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number`);
  }
  return parsed;
};

const optionalStringList = (name: string): string[] => {
  const value = process.env[name];
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

export const config = {
  app: {
    logLevel: process.env.LOG_LEVEL ?? 'info',
    timezone: process.env.TZ ?? 'UTC'
  },
  telegram: {
    apiId: Number(required('TELEGRAM_API_ID')),
    apiHash: required('TELEGRAM_API_HASH'),
    phoneNumber: required('TELEGRAM_PHONE_NUMBER'),
    password: process.env.TELEGRAM_PASSWORD,
    sessionPath: process.env.TELEGRAM_SESSION_PATH ?? '/app/data/telegram.session',
    channels: optionalStringList('TELEGRAM_CHANNELS')
  },
  bot: {
    token: required('BOT_TOKEN'),
    chatId: required('BOT_CHAT_ID')
  },
  openRouter: {
    apiKey: required('OPENROUTER_API_KEY'),
    model: process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini',
    timeoutMs: optionalNumber('OPENROUTER_TIMEOUT_MS') ?? 15000,
    maxRetries: optionalNumber('OPENROUTER_MAX_RETRIES') ?? 3,
    maxInputChars: optionalNumber('OPENROUTER_MAX_INPUT_CHARS') ?? 4000,
    maxCostUsd: optionalNumber('OPENROUTER_MAX_COST_USD') ?? 0.03,
    siteUrl: process.env.OPENROUTER_SITE_URL,
    siteName: process.env.OPENROUTER_SITE_NAME
  },
  filters: {
    maxPrice: optionalNumber('MAX_PRICE'),
    departureCities: optionalStringList('DEPARTURE_CITIES'),
    minNights: optionalNumber('MIN_NIGHTS'),
    maxNights: optionalNumber('MAX_NIGHTS'),
    dateFrom: process.env.DATE_FROM,
    dateTo: process.env.DATE_TO
  },
  database: {
    path: process.env.SQLITE_PATH ?? '/app/data/tours.db'
  }
};
