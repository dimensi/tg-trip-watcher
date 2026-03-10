import pino from 'pino';
import { initJsonConfig, getJsonConfig, watchConfigFile } from './config';
import { TourDatabase } from './db';
import { TelegramNotifier } from './notifier/telegramNotifier';
import { TourService } from './services/tourService';
import { TelegramWatcher } from './telegram/watcher';
import { startPolling, sendMessage } from './bot';
import { setupOnboarding, tryAutoConnect } from './bot/onboarding';
import { setupCommands } from './bot/commands';
import { TelegramClient } from 'telegram';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const bootstrap = async (): Promise<void> => {
  initJsonConfig();
  watchConfigFile();

  const db = new TourDatabase(process.env.SQLITE_PATH ?? './data/tours.db');
  const notifier = new TelegramNotifier();
  const service = new TourService(db, notifier);

  let telegramClient: TelegramClient | null = null;
  let watcher: TelegramWatcher | null = null;

  const startWatcher = async (client: TelegramClient): Promise<void> => {
    telegramClient = client;
    watcher = new TelegramWatcher(client, async (message) => service.processMessage(message));
    watcher.start().catch((err) => logger.error({ err }, 'Watcher error'));
    logger.info('Watcher started');
  };

  setupCommands(() => ({
    authorized: telegramClient !== null,
    watching: watcher !== null,
  }));

  setupOnboarding((client) => {
    startWatcher(client).catch((err) => logger.error({ err }, 'Failed to start watcher after onboarding'));
  });

  const abortController = new AbortController();

  const stop = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down gracefully');
    abortController.abort();
    if (telegramClient) await telegramClient.disconnect();
    db.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));

  // Try auto-connect if session exists
  const cfg = getJsonConfig();
  const client = await tryAutoConnect();
  if (client) {
    await startWatcher(client);
    if (cfg.chatId) {
      await sendMessage(cfg.chatId, 'Бот запущен, мониторинг активен.');
    }
  } else {
    logger.info('No Telegram session found. Waiting for /start command...');
  }

  // Start bot polling (blocking)
  await startPolling(abortController.signal);
};

bootstrap().catch((error) => {
  logger.fatal({ err: error }, 'Fatal startup error');
  process.exit(1);
});
