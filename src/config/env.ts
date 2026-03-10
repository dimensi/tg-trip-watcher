import dotenv from 'dotenv';

dotenv.config();

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const envConfig = {
  telegramApiId: Number(required('TELEGRAM_API_ID')),
  telegramApiHash: required('TELEGRAM_API_HASH'),
  botToken: required('BOT_TOKEN'),
  openRouterApiKey: required('OPENROUTER_API_KEY'),
};
