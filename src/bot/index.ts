import { Bot } from 'grammy';
import pino from 'pino';
import { envConfig, getJsonConfig } from '../config';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'bot' });

export const bot = new Bot(envConfig.botToken);

// Authorization middleware — silently drops messages from unauthorized chats
bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  const cfg = getJsonConfig();
  if (cfg.chatId !== null && cfg.chatId !== chatId) {
    logger.warn({ chatId }, 'Unauthorized message ignored');
    return;
  }
  await next();
});

bot.catch((err) => {
  logger.error({ err: err.error }, 'Bot error');
});

export const sendMessage = async (chatId: number, text: string): Promise<void> => {
  await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
};

export const startPolling = async (signal: AbortSignal): Promise<void> => {
  signal.addEventListener('abort', () => {
    bot.stop().catch((err: unknown) => logger.error({ err }, 'Error stopping bot'));
  });
  logger.info('Bot polling started');
  await bot.start();
};
