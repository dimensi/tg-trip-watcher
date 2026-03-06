import pino from 'pino';
import { config } from './config';
import { TourDatabase } from './db';
import { TelegramNotifier } from './notifier/telegramNotifier';
import { TourService } from './services/tourService';
import { createTelegramClient } from './telegram/client';
import { TelegramWatcher } from './telegram/watcher';

const logger = pino({ level: config.app.logLevel });

const bootstrap = async (): Promise<void> => {
  const db = new TourDatabase();
  const notifier = new TelegramNotifier();
  const service = new TourService(db, notifier);
  const client = await createTelegramClient();
  const watcher = new TelegramWatcher(client, async (message) => service.processMessage(message));

  const stop = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down gracefully');
    await client.disconnect();
    db.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void stop('SIGTERM');
  });

  process.on('SIGINT', () => {
    void stop('SIGINT');
  });

  await watcher.start();
};

bootstrap().catch((error) => {
  logger.fatal({ err: error }, 'Fatal startup error');
  process.exit(1);
});
