export interface ParsedTour {
  destination: string;
  nights?: number;
  departureCities: string[];
  dateStart: string;
  dateEnd?: string;
  price?: number;
  bookingUrl?: string;
  confidence: number;
}

export interface RawMessageContext {
  sourceChannel: string;
  messageId: number;
  text: string;
  sourceChannelUsername?: string;
}

export interface StoredTourRecord {
  id: number;
  source_channel: string;
  message_id: number;
  raw_text: string;
  parsed_json: string;
  matched_filters: number;
  created_at: string;
}

export interface TourFilters {
  maxPrice?: number;
  departureCities: string[];
  arrivalCities: string[];
  minNights?: number;
  maxNights?: number;
  dateFrom?: string;
  dateTo?: string;
}

export interface BotNotificationPayload {
  chatId: string;
  text: string;
}
