import { Bot, BotError } from 'grammy';
import { envConfig, getJsonConfig } from '../config';
import { createLogger } from '../logging/logger';

const logger = createLogger('bot');

/** `sensitiveLogs: false` (default): HttpError message must not include raw fetch URL (token). */
export const bot = new Bot(envConfig.botToken, {
  client: { sensitiveLogs: false },
});

export const isStartCommand = (text: string | undefined): boolean => {
  if (!text) return false;
  return /^\/start(?:@\w+)?(?:\s|$)/.test(text.trim());
};

export const shouldAllowUpdateByChat = (
  configuredChatId: number | null,
  incomingChatId: number,
  text: string | undefined
): boolean => {
  if (configuredChatId === null) return true;
  if (configuredChatId === incomingChatId) return true;
  return isStartCommand(text);
};

// Authorization middleware — silently drops messages from unauthorized chats
bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  const cfg = getJsonConfig();
  const text = ctx.message?.text;
  if (!shouldAllowUpdateByChat(cfg.chatId, chatId, text)) {
    logger.warn({ chatId }, 'Unauthorized message ignored');
    return;
  }
  await next();
});

bot.catch((err: BotError) => {
  logger.error({ err: err.error, chatId: err.ctx.chat?.id, update: err.ctx.update }, 'Bot handler error');
});

export const sendMessage = async (chatId: number, text: string): Promise<void> => {
  await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
};

export const createPollingOptions = (signal: AbortSignal): Parameters<typeof bot.start>[0] => ({
  drop_pending_updates: true,
  onStart: () => {
    logger.info('Bot polling started');
    signal.addEventListener('abort', () => {
      bot.stop().catch((err: unknown) => logger.error({ err }, 'Error stopping bot'));
    });
  },
});

export const startPolling = async (signal: AbortSignal): Promise<void> => {
  await bot.start(createPollingOptions(signal));
};
