import Database from 'better-sqlite3';
import pino from 'pino';
import { ParsedTour, RawMessageContext, StoredTourRecord } from './types/tour';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'db' });

export class TourDatabase {
  private readonly db: Database.Database;

  public constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tours (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_channel TEXT NOT NULL,
        message_id INTEGER NOT NULL,
        offer_index INTEGER NOT NULL DEFAULT 0,
        raw_text TEXT NOT NULL,
        parsed_json TEXT NOT NULL,
        matched_filters INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(source_channel, message_id, offer_index)
      );

      CREATE TABLE IF NOT EXISTS sent_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tour_id INTEGER NOT NULL,
        sent_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(tour_id),
        FOREIGN KEY(tour_id) REFERENCES tours(id)
      );
    `);

    const cols = this.db.prepare(`PRAGMA table_info(tours)`).all() as { name: string }[];
    const hasOfferIndex = cols.some((c) => c.name === 'offer_index');
    if (!hasOfferIndex) {
      logger.info('Migrating tours: add offer_index for multi-offer messages');
      this.db.exec('PRAGMA foreign_keys = OFF');
      this.db.exec(`
        CREATE TABLE tours_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_channel TEXT NOT NULL,
          message_id INTEGER NOT NULL,
          offer_index INTEGER NOT NULL DEFAULT 0,
          raw_text TEXT NOT NULL,
          parsed_json TEXT NOT NULL,
          matched_filters INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(source_channel, message_id, offer_index)
        );
        INSERT INTO tours_new (id, source_channel, message_id, offer_index, raw_text, parsed_json, matched_filters, created_at)
        SELECT id, source_channel, message_id, 0, raw_text, parsed_json, matched_filters, created_at FROM tours;
        DROP TABLE tours;
        ALTER TABLE tours_new RENAME TO tours;
      `);
      this.db.exec('PRAGMA foreign_keys = ON');
    }

    logger.info('Database migration complete');
  }

  public saveTour(
    context: RawMessageContext,
    parsed: ParsedTour,
    matchedFilters: boolean,
    offerIndex = 0
  ): number | null {
    const statement = this.db.prepare(`
      INSERT OR IGNORE INTO tours (source_channel, message_id, offer_index, raw_text, parsed_json, matched_filters)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = statement.run(
      context.sourceChannel,
      context.messageId,
      offerIndex,
      context.text,
      JSON.stringify(parsed),
      matchedFilters ? 1 : 0
    );

    if (result.changes === 0) {
      return null;
    }

    return Number(result.lastInsertRowid);
  }

  public hasNotification(tourId: number): boolean {
    const row = this.db.prepare('SELECT id FROM sent_notifications WHERE tour_id = ?').get(tourId) as { id: number } | undefined;
    return Boolean(row);
  }

  public markNotificationSent(tourId: number): void {
    this.db.prepare('INSERT OR IGNORE INTO sent_notifications (tour_id) VALUES (?)').run(tourId);
  }

  public listTours(limit = 50): StoredTourRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM tours ORDER BY created_at DESC LIMIT ?')
      .all(limit) as StoredTourRecord[];
    return rows;
  }

  public close(): void {
    this.db.close();
  }
}
