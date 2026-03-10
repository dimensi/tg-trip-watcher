import pino from 'pino';
import { envConfig, getJsonConfig } from '../config';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'bot' });

const API_BASE = `https://api.telegram.org/bot${envConfig.botToken}`;

interface TgUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    from?: { id: number };
    text?: string;
  };
}

export const sendMessage = async (chatId: number, text: string): Promise<void> => {
  const response = await fetch(`${API_BASE}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  if (!response.ok) {
    const body = await response.text();
    logger.error({ body, chatId }, 'sendMessage failed');
  }
};

type CommandHandler = (chatId: number, args: string) => Promise<void>;

const commands = new Map<string, CommandHandler>();

export const registerCommand = (name: string, handler: CommandHandler): void => {
  commands.set(name, handler);
};

let onTextMessage: ((chatId: number, text: string) => Promise<void>) | null = null;

export const setTextHandler = (handler: ((chatId: number, text: string) => Promise<void>) | null): void => {
  onTextMessage = handler;
};

const isAuthorized = (chatId: number): boolean => {
  const cfg = getJsonConfig();
  return cfg.chatId === null || cfg.chatId === chatId;
};

const processUpdate = async (update: TgUpdate): Promise<void> => {
  const message = update.message;
  if (!message?.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();

  if (!isAuthorized(chatId)) {
    logger.warn({ chatId }, 'Unauthorized message ignored');
    return;
  }

  if (text.startsWith('/')) {
    const spaceIdx = text.indexOf(' ');
    const cmd = spaceIdx === -1 ? text.slice(1).toLowerCase() : text.slice(1, spaceIdx).toLowerCase();
    const args = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();

    const handler = commands.get(cmd);
    if (handler) {
      await handler(chatId, args);
    } else {
      const helpHandler = commands.get('help');
      if (helpHandler) await helpHandler(chatId, '');
    }
    return;
  }

  if (onTextMessage) {
    await onTextMessage(chatId, text);
  }
};

export const startPolling = async (signal: AbortSignal): Promise<void> => {
  let offset = 0;
  logger.info('Bot polling started');

  while (!signal.aborted) {
    try {
      const response = await fetch(`${API_BASE}/getUpdates?offset=${offset}&timeout=30`, {
        signal,
      });

      if (!response.ok) {
        logger.error({ status: response.status }, 'getUpdates failed');
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      const data = (await response.json()) as { ok: boolean; result: TgUpdate[] };
      for (const update of data.result) {
        await processUpdate(update);
        offset = update.update_id + 1;
      }
    } catch (error) {
      if (signal.aborted) break;
      logger.error({ err: error }, 'Polling error, retrying');
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
};
