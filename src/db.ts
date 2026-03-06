import Database from 'better-sqlite3';
import pino from 'pino';
import { config } from './config';
import { ParsedTour, RawMessageContext, StoredTourRecord } from './types/tour';

const logger = pino({ level: config.app.logLevel }).child({ module: 'db' });

export class TourDatabase {
  private readonly db: Database.Database;

  public constructor() {
    this.db = new Database(config.database.path);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tours (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_channel TEXT NOT NULL,
        message_id INTEGER NOT NULL,
        raw_text TEXT NOT NULL,
        parsed_json TEXT NOT NULL,
        matched_filters INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(source_channel, message_id)
      );

      CREATE TABLE IF NOT EXISTS sent_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tour_id INTEGER NOT NULL,
        sent_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(tour_id),
        FOREIGN KEY(tour_id) REFERENCES tours(id)
      );
    `);
    logger.info('Database migration complete');
  }

  public saveTour(context: RawMessageContext, parsed: ParsedTour, matchedFilters: boolean): number | null {
    const statement = this.db.prepare(`
      INSERT OR IGNORE INTO tours (source_channel, message_id, raw_text, parsed_json, matched_filters)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = statement.run(
      context.sourceChannel,
      context.messageId,
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
