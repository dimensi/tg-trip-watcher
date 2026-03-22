import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { envConfig, getJsonConfig, updateJsonConfig } from '../config';
import { buildTelegramClientParams } from '../telegram/mtProxy';
import { bot, sendMessage } from './index';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'onboarding' });

const AUTH_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Active resolver during auth flow — null when no auth in progress
let authTextResolver: ((text: string) => void) | null = null;
let authFlowInProgress = false;
const telegramClientParams = buildTelegramClientParams(process.env.MT_PROXY);

export const normalizeAuthInput = (text: string): string | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/')) return null;
  return trimmed;
};

export const canStartAuthFlow = (inProgress: boolean): boolean => !inProgress;

type AsyncOnAuthorized = (client: TelegramClient) => Promise<void>;

export const setupOnboarding = (onAuthorized: AsyncOnAuthorized): void => {
  bot.command('start', async (ctx) => {
    const chatId = ctx.chat.id;
    const existing = getJsonConfig().chatId;

    if (existing === null) {
      updateJsonConfig((draft) => { draft.chatId = chatId; });
    } else if (existing !== chatId) {
      logger.warn({ chatId }, 'Unauthorized /start attempt ignored — chatId already set');
      await sendMessage(chatId, '❌ Бот уже привязан к другому чату. Сбросьте `chatId` в data/config.json в `null` и отправьте /start снова.');
      return;
    }

    const cfg = getJsonConfig();
    const sessionPath = cfg.telegram.sessionPath;

    if (fs.existsSync(sessionPath)) {
      const sessionStr = fs.readFileSync(sessionPath, 'utf8');
      if (sessionStr) {
        await sendMessage(chatId, 'Сессия найдена. Подключаюсь к Telegram...');
        try {
          const client = await connectWithSession(sessionStr);
          await onAuthorized(client);
          await sendMessage(chatId, '✅ Подключено! Мониторинг запущен.');
          return;
        } catch {
          await sendMessage(chatId, 'Сессия устарела. Нужна повторная авторизация.');
        }
      }
    }

    if (!process.env.TELEGRAM_PHONE_NUMBER) {
      await sendMessage(chatId, '❌ Переменная TELEGRAM_PHONE_NUMBER не задана. Добавьте её в .env и перезапустите бот.');
      return;
    }

    if (!canStartAuthFlow(authFlowInProgress)) {
      await sendMessage(chatId, '⚠️ Авторизация уже выполняется. Введите код из Telegram или дождитесь таймаута (10 мин).');
      return;
    }

    await sendMessage(chatId, 'Начинаю авторизацию в Telegram...');
    authFlowInProgress = true;
    void startAuthFlow(chatId, onAuthorized);
  });

  // Routes free-text messages to auth flow resolver when active
  bot.on('message:text', async (ctx, next) => {
    if (!authTextResolver) {
      await next();
      return;
    }
    const input = normalizeAuthInput(ctx.message.text);
    if (input === null) {
      await next();
      return;
    }
    const resolver = authTextResolver;
    authTextResolver = null;
    resolver(input);
  });
};

const connectWithSession = async (sessionStr: string): Promise<TelegramClient> => {
  const client = new TelegramClient(
    new StringSession(sessionStr),
    envConfig.telegramApiId,
    envConfig.telegramApiHash,
    telegramClientParams
  );
  await client.connect();
  if (!(await client.isUserAuthorized())) {
    throw new Error('Session is not authorized');
  }
  return client;
};

const startAuthFlow = async (chatId: number, onAuthorized: AsyncOnAuthorized): Promise<void> => {
  const cfg = getJsonConfig();
  const phoneNumber = process.env.TELEGRAM_PHONE_NUMBER!;

  const client = new TelegramClient(
    new StringSession(''),
    envConfig.telegramApiId,
    envConfig.telegramApiHash,
    telegramClientParams
  );

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Auth flow timed out after 10 minutes')), AUTH_TIMEOUT_MS)
  );

  try {
    await Promise.race([
      client.start({
        phoneNumber: async () => phoneNumber,
        phoneCode: async () => {
          await sendMessage(chatId, 'Введите код авторизации из Telegram:');
          return new Promise<string>((resolve) => {
            authTextResolver = resolve;
          });
        },
        password: async () => {
          await sendMessage(chatId, 'Введите пароль 2FA:');
          return new Promise<string>((resolve) => {
            authTextResolver = resolve;
          });
        },
        onError: (err) => logger.error({ err }, 'Auth error'),
      }),
      timeout,
    ]);

    const sessionStr = String(client.session.save());
    const sessionPath = cfg.telegram.sessionPath;
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, sessionStr, 'utf8');

    await onAuthorized(client);
    await sendMessage(chatId, '✅ Авторизация успешна! Мониторинг запущен.');
  } catch (error) {
    logger.error({ err: error }, 'Auth flow failed');
    await sendMessage(chatId, `❌ Ошибка авторизации: ${error instanceof Error ? error.message : 'unknown'}`);
  } finally {
    authTextResolver = null;
    authFlowInProgress = false;
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
