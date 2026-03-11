import pino from 'pino';
import { NewMessage } from 'telegram/events';
import { Api, TelegramClient } from 'telegram';
import { getJsonConfig } from '../config';
import { RawMessageContext } from '../types/tour';
import { shouldConnectClient } from './watcherConnection';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'telegram-watcher' });

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class TelegramWatcher {
  public constructor(
    private readonly client: TelegramClient,
    private readonly onMessage: (message: RawMessageContext) => Promise<void>
  ) {}

  public async start(): Promise<void> {
    const channels = getJsonConfig().telegram.channels;
    if (channels.length === 0) {
      throw new Error('No channels configured. Use /addchannel to add channels.');
    }

    logger.info({ channels }, 'Starting Telegram watcher');

    this.client.addEventHandler(async (event) => {
      try {
        const message = event.message as Api.Message;
        const channel = await message.getChat();
        const channelTitle = channel && 'title' in channel ? channel.title : 'unknown';
        const channelUsername = channel && 'username' in channel ? channel.username : undefined;
        const text = message.message;

        if (!text) return;

        await this.onMessage({
          sourceChannel: channelTitle,
          messageId: message.id,
          text,
          sourceChannelUsername: channelUsername,
        });
      } catch (error) {
        const maybeError = error as { errorMessage?: string; seconds?: number };
        if (maybeError.errorMessage?.includes('FLOOD_WAIT') && maybeError.seconds) {
          logger.warn({ seconds: maybeError.seconds }, 'Flood wait detected');
          await sleep(maybeError.seconds * 1000);
          return;
        }
        logger.error({ err: error }, 'Failed to process Telegram message event');
      }
    }, new NewMessage({ chats: channels }));

    try {
      if (shouldConnectClient(this.client.connected)) {
        await this.client.connect();
      } else {
        logger.debug('Skipping connect: Telegram client already connected');
      }
    } catch (error) {
      logger.error({ err: error }, 'Telegram connect failed');
      await sleep(3000);
      throw error;
    }
  }
}
