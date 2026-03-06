import pino from 'pino';
import { config } from '../config';
import { ParsedTour } from '../types/tour';

const logger = pino({ level: config.app.logLevel }).child({ module: 'telegram-notifier' });

const formatTour = (tour: ParsedTour): string => {
  return [
    '🔥 Найден тур',
    '',
    `Направление: ${tour.destination}`,
    `Вылет: ${tour.departureCities.join(', ')}`,
    `Даты: ${tour.dateStart} - ${tour.dateEnd}`,
    `Ночей: ${tour.nights}`,
    `Цена: ${tour.price} ₽`,
    `Ссылка: ${tour.bookingUrl}`
  ].join('\n');
};

export class TelegramNotifier {
  public async sendTour(tour: ParsedTour): Promise<void> {
    const response = await fetch(`https://api.telegram.org/bot${config.bot.token}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: config.bot.chatId,
        text: formatTour(tour),
        disable_web_page_preview: false
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ errorBody }, 'Failed to send Telegram notification');
      throw new Error(`Telegram Bot API error: ${response.status}`);
    }

    logger.info('Tour notification sent');
  }
}
