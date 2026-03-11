import pino from 'pino';
import { initJsonConfig, getJsonConfig, watchConfigFile } from './config';
import { TourDatabase } from './db';
import { TelegramNotifier } from './notifier/telegramNotifier';
import { TourService } from './services/tourService';
import { TelegramWatcher } from './telegram/watcher';
import { watcherConfigErrorForChannels } from './telegram/watcherConfig';
import { canStartWatcher } from './telegram/watcherStartGuard';
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
  let watcherStartInProgress = false;

  const startWatcher = async (client: TelegramClient): Promise<void> => {
    if (!canStartWatcher(watcher !== null, watcherStartInProgress)) {
      logger.warn('Watcher start skipped: already running or starting');
      return;
    }
    watcherStartInProgress = true;

    const configError = watcherConfigErrorForChannels(getJsonConfig().telegram.channels);
    if (configError) {
      watcherStartInProgress = false;
      throw new Error(configError);
    }

    telegramClient = client;
    watcher = new TelegramWatcher(client, async (message) => service.processMessage(message));
    watcher.start().catch(async (err) => {
      watcher = null;
      logger.error({ err }, 'Watcher error');
      const chatId = getJsonConfig().chatId;
      if (chatId) {
        const reason = err instanceof Error ? err.message : 'unknown';
        await sendMessage(chatId, `❌ Ошибка мониторинга: ${reason}`);
      }
    });
    watcherStartInProgress = false;
    logger.info('Watcher started');
  };

  setupOnboarding(async (client) => {
    await startWatcher(client);
  });

  setupCommands(() => ({
    authorized: telegramClient !== null,
    watching: watcher !== null,
  }));

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
    try {
      await startWatcher(client);
    } catch (error) {
      logger.error({ err: error }, 'Failed to start watcher from saved session');
      if (cfg.chatId) {
        const reason = error instanceof Error ? error.message : 'unknown';
        await sendMessage(cfg.chatId, `❌ Мониторинг не запущен: ${reason}`);
      }
    }
    if (cfg.chatId && watcher) {
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
