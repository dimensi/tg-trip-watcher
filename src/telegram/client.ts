import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { config } from '../config';

const logger = pino({ level: config.app.logLevel }).child({ module: 'telegram-client' });

export const createTelegramClient = async (): Promise<TelegramClient> => {
  const sessionPath = config.telegram.sessionPath;
  const dir = path.dirname(sessionPath);
  fs.mkdirSync(dir, { recursive: true });

  const existingSession = fs.existsSync(sessionPath) ? fs.readFileSync(sessionPath, 'utf8') : '';
  const client = new TelegramClient(new StringSession(existingSession), config.telegram.apiId, config.telegram.apiHash, {
    connectionRetries: 10,
    useWSS: true
  });

  await client.start({
    phoneNumber: async () => config.telegram.phoneNumber,
    password: async () => config.telegram.password ?? '',
    phoneCode: async () => {
      const phoneCode = process.env.TELEGRAM_LOGIN_CODE;
      if (!phoneCode) {
        throw new Error('TELEGRAM_LOGIN_CODE is required for first authorization in non-interactive mode');
      }
      return phoneCode;
    },
    onError: (err) => logger.error({ err }, 'Telegram auth error')
  });

  fs.writeFileSync(sessionPath, String(client.session.save()));
  logger.info('Telegram client authorized and session saved');

  return client;
};
