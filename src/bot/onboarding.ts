import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { envConfig, getJsonConfig, updateJsonConfig } from '../config';
import { sendMessage, registerCommand, setTextHandler } from './index';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'onboarding' });

type OnAuthorized = (client: TelegramClient) => void;

export const setupOnboarding = (onAuthorized: OnAuthorized): void => {
  registerCommand('start', async (chatId: number) => {
    updateJsonConfig((draft) => {
      draft.chatId = chatId;
    });

    const cfg = getJsonConfig();
    const sessionPath = cfg.telegram.sessionPath;

    if (fs.existsSync(sessionPath)) {
      const sessionStr = fs.readFileSync(sessionPath, 'utf8');
      if (sessionStr) {
        await sendMessage(chatId, 'Сессия найдена. Подключаюсь к Telegram...');
        try {
          const client = await connectWithSession(sessionStr);
          onAuthorized(client);
          await sendMessage(chatId, '✅ Подключено! Мониторинг запущен.');
          return;
        } catch {
          await sendMessage(chatId, 'Сессия устарела. Нужна повторная авторизация.');
        }
      }
    }

    await sendMessage(chatId, 'Отправляю код авторизации на номер телефона...');
    await startAuthFlow(chatId, onAuthorized);
  });
};

const connectWithSession = async (sessionStr: string): Promise<TelegramClient> => {
  const client = new TelegramClient(
    new StringSession(sessionStr),
    envConfig.telegramApiId,
    envConfig.telegramApiHash,
    { connectionRetries: 10, useWSS: true }
  );
  await client.connect();
  if (!(await client.isUserAuthorized())) {
    throw new Error('Session is not authorized');
  }
  return client;
};

const startAuthFlow = async (chatId: number, onAuthorized: OnAuthorized): Promise<void> => {
  const cfg = getJsonConfig();
  const phoneNumber = process.env.TELEGRAM_PHONE_NUMBER;

  if (!phoneNumber) {
    await sendMessage(chatId, 'Установите TELEGRAM_PHONE_NUMBER в .env и перезапустите.');
    return;
  }

  const client = new TelegramClient(
    new StringSession(''),
    envConfig.telegramApiId,
    envConfig.telegramApiHash,
    { connectionRetries: 10, useWSS: true }
  );

  let resolveCode: ((code: string) => void) | null = null;
  let resolvePassword: ((password: string) => void) | null = null;

  setTextHandler(async (_chatId: number, text: string) => {
    if (resolveCode) {
      resolveCode(text);
      resolveCode = null;
    } else if (resolvePassword) {
      resolvePassword(text);
      resolvePassword = null;
    }
  });

  try {
    await client.start({
      phoneNumber: async () => phoneNumber,
      phoneCode: async () => {
        await sendMessage(chatId, 'Введите код авторизации из Telegram:');
        return new Promise<string>((resolve) => {
          resolveCode = resolve;
        });
      },
      password: async () => {
        await sendMessage(chatId, 'Введите пароль 2FA:');
        return new Promise<string>((resolve) => {
          resolvePassword = resolve;
        });
      },
      onError: (err) => logger.error({ err }, 'Auth error'),
    });

    const sessionStr = String(client.session.save());
    const sessionPath = cfg.telegram.sessionPath;
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, sessionStr, 'utf8');

    setTextHandler(null);
    onAuthorized(client);
    await sendMessage(chatId, '✅ Авторизация успешна! Мониторинг запущен.');
  } catch (error) {
    setTextHandler(null);
    logger.error({ err: error }, 'Auth flow failed');
    await sendMessage(chatId, `❌ Ошибка авторизации: ${error instanceof Error ? error.message : 'unknown'}`);
  }
};

export const tryAutoConnect = async (): Promise<TelegramClient | null> => {
  const cfg = getJsonConfig();
  const sessionPath = cfg.telegram.sessionPath;

  if (!fs.existsSync(sessionPath)) return null;

  const sessionStr = fs.readFileSync(sessionPath, 'utf8');
  if (!sessionStr) return null;

  try {
    return await connectWithSession(sessionStr);
  } catch (error) {
    logger.warn({ err: error }, 'Auto-connect failed, waiting for /start');
    return null;
  }
};
