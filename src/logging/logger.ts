import pino from 'pino';
import { envConfig } from '../config/env';

const redactBotToken = (s: string): string => {
  const t = envConfig.botToken;
  if (!t || s.length === 0) return s;
  return s.includes(t) ? s.split(t).join('[REDACTED_BOT_TOKEN]') : s;
};

const deepRedact = (v: unknown, depth = 0): unknown => {
  if (depth > 15) return v;
  if (typeof v === 'string') return redactBotToken(v);
  if (v && typeof v === 'object') {
    if (Array.isArray(v)) return v.map((x) => deepRedact(x, depth + 1));
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      out[k] = deepRedact(o[k], depth + 1);
    }
    return out;
  }
  return v;
};

const errSerializer = (err: Error): Record<string, unknown> => {
  const base = pino.stdSerializers.err(err);
  return deepRedact(base) as Record<string, unknown>;
};

/** Root logger: child loggers inherit `err` serializer (token-safe nested errors). */
export const rootLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  serializers: {
    err: errSerializer,
  },
});

export const createLogger = (module: string): pino.Logger =>
  rootLogger.child({ module });
