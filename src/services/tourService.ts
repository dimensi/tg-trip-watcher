import { createLogger } from '../logging/logger';
import { getJsonConfig } from '../config';
import { TourDatabase } from '../db';
import { matchesFilters } from '../filters/tourFilters';
import { TelegramNotifier } from '../notifier/telegramNotifier';
import { parseTours } from '../parser';
import { RawMessageContext } from '../types/tour';

const logger = createLogger('tour-service');

export class TourService {
  public constructor(
    private readonly db: TourDatabase,
    private readonly notifier: TelegramNotifier
  ) {}

  public async processMessage(message: RawMessageContext): Promise<void> {
    try {
      const tours = await parseTours(message.text);

      for (let offerIndex = 0; offerIndex < tours.length; offerIndex += 1) {
        const parsed = tours[offerIndex];
        const matched = matchesFilters(parsed, getJsonConfig().filters);
        const tourId = this.db.saveTour(message, parsed, matched, offerIndex);

        if (tourId === null) {
          logger.debug(
            { sourceChannel: message.sourceChannel, messageId: message.messageId, offerIndex },
            'Duplicate tour row ignored',
          );
          continue;
        }

        logger.info({ tourId, offerIndex, matched, confidence: parsed.confidence }, 'Tour saved');

        if (!matched) continue;

        if (this.db.hasNotification(tourId)) {
          logger.debug({ tourId }, 'Notification already sent');
          continue;
        }

        await this.notifier.sendTour(parsed, message);
        this.db.markNotificationSent(tourId);
      }
    } catch (error) {
      logger.warn({ err: error, message }, 'Failed to process message as tour');
    }
  }
}
