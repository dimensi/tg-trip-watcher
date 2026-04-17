import { createLogger } from '../logging/logger';
import { envConfig, getJsonConfig } from '../config';
import { ParsedTour, RawMessageContext } from '../types/tour';

const logger = createLogger('telegram-notifier');

const buildSourcePostLink = (source?: RawMessageContext): string | null => {
  if (!source?.sourceChannelUsername) return null;
  return `https://t.me/${source.sourceChannelUsername}/${source.messageId}`;
};

const formatTour = (tour: ParsedTour, source?: RawMessageContext): string => {
  const sourceLink = buildSourcePostLink(source);
  const dateLine = tour.dateEnd ? `${tour.dateStart} - ${tour.dateEnd}` : tour.dateStart;
  return [
    '🔥 Найден тур',
    '',
    `Направление: ${tour.destination}`,
    `Вылет: ${tour.departureCities.join(', ')}`,
    `Даты: ${dateLine}`,
    tour.nights !== undefined ? `Ночей: ${tour.nights}` : null,
    tour.price !== undefined ? `Цена: ${tour.price} ₽` : null,
    tour.bookingUrl ? `Ссылка: ${tour.bookingUrl}` : null,
    sourceLink ? `Пост в канале: ${sourceLink}` : null,
    sourceLink ? `Канал: ${source?.sourceChannel ?? 'unknown'}` : null,
  ].filter((line): line is string => Boolean(line)).join('\n');
};

export class TelegramNotifier {
  public async sendTour(tour: ParsedTour, source?: RawMessageContext): Promise<void> {
    const chatId = getJsonConfig().chatId;
    if (!chatId) {
      logger.warn('Cannot send notification: chatId not set. Send /start to the bot.');
      return;
    }

    const response = await fetch(`https://api.telegram.org/bot${envConfig.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatTour(tour, source),
        disable_web_page_preview: false,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ errorBody }, 'Failed to send Telegram notification');
      throw new Error(`Telegram Bot API error: ${response.status}`);
    }

    logger.info('Tour notification sent');
  }
}
