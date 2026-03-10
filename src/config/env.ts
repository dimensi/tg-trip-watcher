import dotenv from 'dotenv';

dotenv.config();

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const requiredInt = (name: string): number => {
  const raw = required(name);
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer, got: ${JSON.stringify(raw)}`);
  }
  return n;
};

export const envConfig = {
  telegramApiId: requiredInt('TELEGRAM_API_ID'),
  telegramApiHash: required('TELEGRAM_API_HASH'),
  botToken: required('BOT_TOKEN'),
  openRouterApiKey: required('OPENROUTER_API_KEY'),
};
