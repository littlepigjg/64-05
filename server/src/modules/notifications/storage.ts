import fs from 'fs';
import path from 'path';
import { ensureDir } from '../../utils';
import type { NotificationsDB } from './types';

export class NotificationStorage {
  private dataDir: string;
  private dbPath: string;
  private db: NotificationsDB;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    ensureDir(dataDir);
    this.dbPath = path.join(dataDir, 'notifications.json');
    this.db = this.loadDB();
  }

  private loadDB(): NotificationsDB {
    if (fs.existsSync(this.dbPath)) {
      try {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          notifications: parsed.notifications || [],
          lastChecked: parsed.lastChecked || 0,
          versionCheckResults: parsed.versionCheckResults || {},
        };
      } catch {
        // fall through to default
      }
    }
    return {
      notifications: [],
      lastChecked: 0,
      versionCheckResults: {},
    };
  }

  /**
   * Debounced save for non-critical updates (e.g. read-status toggles).
   */
  scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persist();
    }, 200);
  }

  /**
   * Synchronously persist to disk immediately.
   *
   * This MUST be used for critical write operations (e.g. creating a
   * notification) so that the record survives a crash that happens
   * milliseconds later — before the broadcast even reaches clients.
   */
  persistNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.persist();
  }

  private persist(): void {
    ensureDir(this.dataDir);
    const tmpPath = this.dbPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(this.db, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.dbPath);
  }

  getDB(): NotificationsDB {
    return this.db;
  }

  close(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.persist();
  }
}
