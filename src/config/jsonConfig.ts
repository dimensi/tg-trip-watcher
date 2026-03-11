import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'json-config' });

const configSchema = z.object({
  chatId: z.number().nullable().default(null),
  telegram: z.object({
    channels: z.array(z.string()).default([]),
    sessionPath: z.string().default('./data/telegram.session'),
  }).default({ channels: [], sessionPath: './data/telegram.session' }),
  openRouter: z.object({
    model: z.string().default('openai/gpt-4o-mini'),
    timeoutMs: z.number().default(15000),
    maxRetries: z.number().default(3),
    maxInputChars: z.number().default(4000),
    maxCostUsd: z.number().default(0.03),
  }).default({ model: 'openai/gpt-4o-mini', timeoutMs: 15000, maxRetries: 3, maxInputChars: 4000, maxCostUsd: 0.03 }),
  filters: z.object({
    maxPrice: z.number().optional(),
    departureCities: z.array(z.string()).default([]),
    arrivalCities: z.array(z.string()).default([]),
    minNights: z.number().optional(),
    maxNights: z.number().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  }).default({ departureCities: [], arrivalCities: [] }),
});

export type JsonConfig = z.infer<typeof configSchema>;

const CONFIG_PATH = path.resolve(process.env.CONFIG_PATH ?? './data/config.json');

type ConfigListener = (config: JsonConfig) => void;
const listeners: ConfigListener[] = [];

let current: JsonConfig;

const readConfigFile = (): JsonConfig => {
  const dir = path.dirname(CONFIG_PATH);
  fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(CONFIG_PATH)) {
    const defaults = configSchema.parse({});
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2), 'utf8');
    logger.info({ path: CONFIG_PATH }, 'Created default config file');
    return defaults;
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  return configSchema.parse(parsed);
};

const reload = (): void => {
  try {
    const next = readConfigFile();
    current = next;
    for (const listener of listeners) {
      listener(current);
    }
    logger.info('Config reloaded');
  } catch (error) {
    logger.error({ err: error }, 'Failed to reload config, keeping previous values');
  }
};

export const initJsonConfig = (): JsonConfig => {
  current = readConfigFile();
  return current;
};

export const getJsonConfig = (): JsonConfig => current;

export const updateJsonConfig = (updater: (draft: JsonConfig) => void): JsonConfig => {
  const clone = structuredClone(current);
  updater(clone);
  const validated = configSchema.parse(clone);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(validated, null, 2), 'utf8');
  current = validated;
  for (const listener of listeners) {
    listener(current);
  }
  return current;
};

export const onConfigChange = (listener: ConfigListener): void => {
  listeners.push(listener);
};

export const watchConfigFile = (): void => {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  fs.watch(CONFIG_PATH, () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => reload(), 300);
  });
  logger.info({ path: CONFIG_PATH }, 'Watching config file for changes');
};
