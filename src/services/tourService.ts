import pino from 'pino';
import { getJsonConfig } from '../config';
import { TourDatabase } from '../db';
import { matchesFilters } from '../filters/tourFilters';
import { TelegramNotifier } from '../notifier/telegramNotifier';
import { parseTour } from '../parser';
import { RawMessageContext } from '../types/tour';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'tour-service' });

export class TourService {
  public constructor(
    private readonly db: TourDatabase,
    private readonly notifier: TelegramNotifier
  ) {}

  public async processMessage(message: RawMessageContext): Promise<void> {
    try {
      const parsed = await parseTour(message.text);
      const matched = matchesFilters(parsed, getJsonConfig().filters);
      const tourId = this.db.saveTour(message, parsed, matched);

      if (tourId === null) {
        logger.debug({ sourceChannel: message.sourceChannel, messageId: message.messageId }, 'Duplicate message ignored');
        return;
      }

      logger.info({ tourId, matched, confidence: parsed.confidence }, 'Tour saved');

      if (!matched) return;

      if (this.db.hasNotification(tourId)) {
        logger.debug({ tourId }, 'Notification already sent');
        return;
      }

      await this.notifier.sendTour(parsed, message);
      this.db.markNotificationSent(tourId);
    } catch (error) {
      logger.warn({ err: error, message }, 'Failed to process message as tour');
    }
  }
}
