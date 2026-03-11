import pino from 'pino';
import { NewMessage } from 'telegram/events';
import { Api, TelegramClient } from 'telegram';
import { RawMessageContext } from '../types/tour';
import { shouldConnectClient } from './watcherConnection';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'telegram-watcher' });

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class TelegramWatcher {
  private activeEvent: NewMessage | null = null;
  private activeHandler: ((event: { message: Api.Message }) => Promise<void>) | null = null;

  public constructor(
    private readonly client: TelegramClient,
    private readonly onMessage: (message: RawMessageContext) => Promise<void>
  ) {}

  public async start(channels: string[]): Promise<void> {
    if (channels.length === 0) {
      throw new Error('No channels configured. Use /addchannel to add channels.');
    }

    logger.info({ channels }, 'Starting Telegram watcher');

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

    this.bind(channels);
  }

  public async reload(channels: string[]): Promise<void> {
    const previousHandler = this.activeHandler;
    const previousEvent = this.activeEvent;

    await this.start(channels);

    if (previousHandler && previousEvent) {
      this.client.removeEventHandler(previousHandler, previousEvent);
    }
  }

  public stop(): void {
    if (this.activeHandler && this.activeEvent) {
      this.client.removeEventHandler(this.activeHandler, this.activeEvent);
    }
    this.activeHandler = null;
    this.activeEvent = null;
  }

  private bind(channels: string[]): void {
    const eventBuilder = new NewMessage({ chats: channels });
    const handler = async (event: { message: Api.Message }): Promise<void> => {
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
    };

    this.client.addEventHandler(handler, eventBuilder);
    this.activeHandler = handler;
    this.activeEvent = eventBuilder;
  }
}
