import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ensureDir } from '../../utils';
import type { NotificationsDB } from './types';
import { MAX_NOTIFICATIONS } from './types';

const MAX_ROLLING_BACKUPS = 5;
const BACKUP_EXT = '.bak';
const CORRUPTED_EXT = '.corrupted';

export interface LoadRecoveryInfo {
  /** Did we recover from a backup file rather than the primary? */
  recoveredFromBackup: boolean;
  /** Path of the backup file we used (relative), if any. */
  backupUsed?: string;
  /** Was the primary file corrupted and quarantined? */
  primaryCorrupted: boolean;
  /** Path where the corrupted primary was moved to, if quarantined. */
  corruptedPath?: string;
  /** How many backup files we found on disk. */
  backupsAvailable: number;
  /** How many backup files failed to parse. */
  backupsFailed: number;
  /** Any error messages collected during the load attempt. */
  errors: string[];
}

export interface StorageDiagnostics {
  recovery: LoadRecoveryInfo;
  primaryPath: string;
  backups: Array<{ path: string; size: number; modifiedAt: number }>;
  lastPersistAt: number | null;
  lastPersistError: string | null;
}

function emptyDB(): NotificationsDB {
  return {
    notifications: [],
    lastChecked: 0,
    versionCheckResults: {},
  };
}

function isNotificationsDB(obj: unknown): obj is NotificationsDB {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    Array.isArray(o.notifications) &&
    typeof o.lastChecked === 'number' &&
    typeof o.versionCheckResults === 'object' &&
    o.versionCheckResults !== null
  );
}

function validateNotificationsDB(obj: unknown): { valid: true; db: NotificationsDB } | { valid: false; reason: string } {
  if (!isNotificationsDB(obj)) {
    return { valid: false, reason: 'Shape does not match NotificationsDB' };
  }
  if (obj.notifications.length > MAX_NOTIFICATIONS * 2) {
    return { valid: false, reason: `notifications.length (${obj.notifications.length}) exceeds safety limit` };
  }
  for (let i = 0; i < obj.notifications.length; i++) {
    const n = obj.notifications[i];
    if (!n || typeof n !== 'object' || typeof n.id !== 'string' || typeof n.type !== 'string' || typeof n.createdAt !== 'number') {
      return { valid: false, reason: `Invalid notification at index ${i}` };
    }
  }
  return { valid: true, db: obj };
}

/**
 * Storage layer for the notifications database with resilience features:
 *
 *  - Primary/atomic write: write to `.tmp`, fsync, then rename.
 *  - Rolling backups: after every successful persist, write `.bak.N`
 *    files, keeping the most recent N.
 *  - Corruption recovery: if the primary is unreadable, try each backup
 *    in mtime order. Move the corrupted primary to `.corrupted` for
 *    manual forensics.
 *  - Full event logging: any failure is written to console.error so it
 *    shows up in server logs instead of being silently swallowed.
 */
export class NotificationStorage {
  private dataDir: string;
  private dbPath: string;
  private db: NotificationsDB;
  private saveTimer: NodeJS.Timeout | null = null;
  private recovery: LoadRecoveryInfo;
  private lastPersistAt: number | null = null;
  private lastPersistError: string | null = null;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    ensureDir(dataDir);
    this.dbPath = path.join(dataDir, 'notifications.json');

    const result = this.loadDBWithRecovery();
    this.db = result.db;
    this.recovery = result.recovery;

    if (this.recovery.primaryCorrupted) {
      // As soon as we've recovered, write the recovered DB back to the
      // primary so a subsequent restart doesn't have to go to backup.
      try {
        this.persistInternal();
      } catch (e) {
        console.error('[NotificationStorage] Failed to write recovered DB to primary:', e);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Loading + recovery                                                 */
  /* ------------------------------------------------------------------ */

  private loadDBWithRecovery(): { db: NotificationsDB; recovery: LoadRecoveryInfo } {
    const recovery: LoadRecoveryInfo = {
      recoveredFromBackup: false,
      primaryCorrupted: false,
      backupsAvailable: 0,
      backupsFailed: 0,
      errors: [],
    };

    // 1. Try the primary first.
    if (fs.existsSync(this.dbPath)) {
      try {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const check = validateNotificationsDB(parsed);
        if (check.valid) {
          return { db: check.db, recovery };
        }
        recovery.errors.push(`Primary validation failed: ${check.reason}`);
      } catch (e) {
        recovery.errors.push(`Primary parse error: ${(e as Error).message}`);
      }

      // Primary exists but is unusable. Quarantine it and continue to backups.
      recovery.primaryCorrupted = true;
      this.quarantinePrimary();
      recovery.corruptedPath = this.quarantinePath();
      console.error(
        `[NotificationStorage] Primary DB is corrupted! Moved to ${recovery.corruptedPath}. ` +
        `Attempting backup recovery… Errors: ${recovery.errors.join('; ')}`
      );
    }

    // 2. Collect available backups, sort newest-first.
    const backups = this.collectBackups();
    recovery.backupsAvailable = backups.length;

    for (const backup of backups) {
      try {
        const raw = fs.readFileSync(backup.path, 'utf-8');
        const parsed = JSON.parse(raw);
        const check = validateNotificationsDB(parsed);
        if (!check.valid) {
          recovery.backupsFailed++;
          recovery.errors.push(`Backup ${backup.path} invalid: ${check.reason}`);
          continue;
        }
        recovery.recoveredFromBackup = true;
        recovery.backupUsed = backup.path;
        console.warn(
          `[NotificationStorage] Recovered DB from backup ${backup.path} ` +
          `(${check.db.notifications.length} notifications preserved).`
        );
        return { db: check.db, recovery };
      } catch (e) {
        recovery.backupsFailed++;
        recovery.errors.push(`Backup ${backup.path} parse error: ${(e as Error).message}`);
      }
    }

    if (recovery.primaryCorrupted || backups.length > 0) {
      console.error(
        `[NotificationStorage] All ${backups.length} backup(s) exhausted ` +
        `(${recovery.backupsFailed} failed). Starting with empty DB. ` +
        `Manual forensics may be possible at: ${recovery.corruptedPath || this.dbPath}`
      );
    }

    return { db: emptyDB(), recovery };
  }

  private collectBackups(): Array<{ path: string; mtime: number }> {
    try {
      const dirEntries = fs.readdirSync(this.dataDir);
      const matches: Array<{ path: string; mtime: number }> = [];
      const fileName = path.basename(this.dbPath);
      for (const entry of dirEntries) {
        if (entry.startsWith(fileName) && entry.includes(BACKUP_EXT)) {
          const fullPath = path.join(this.dataDir, entry);
          try {
            const stat = fs.statSync(fullPath);
            matches.push({ path: fullPath, mtime: stat.mtimeMs });
          } catch {
            // ignore
          }
        }
      }
      matches.sort((a, b) => b.mtime - a.mtime);
      return matches;
    } catch {
      return [];
    }
  }

  private quarantinePath(): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${this.dbPath}.${stamp}${CORRUPTED_EXT}`;
  }

  private quarantinePrimary(): void {
    try {
      const dest = this.quarantinePath();
      fs.renameSync(this.dbPath, dest);
    } catch (e) {
      // If rename fails, try copy + unlink; if that also fails, leave it
      // and fall through.
      console.error('[NotificationStorage] Failed to quarantine primary:', (e as Error).message);
      try {
        fs.copyFileSync(this.dbPath, this.quarantinePath());
        fs.unlinkSync(this.dbPath);
      } catch (e2) {
        console.error('[NotificationStorage] Quarantine fallback also failed:', (e2 as Error).message);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Persistence                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Debounced save for non-critical updates (e.g. read-status toggles).
   */
  scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        this.persistInternal();
      } catch (e) {
        console.error('[NotificationStorage] scheduleSave persist failed:', e);
      }
    }, 200);
  }

  /**
   * Synchronously persist to disk immediately.
   */
  persistNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.persistInternal();
  }

  private persistInternal(): void {
    ensureDir(this.dataDir);

    // --- Sanity check: never write an obviously-bad DB back to disk. ---
    const validation = validateNotificationsDB(this.db);
    if (!validation.valid) {
      const msg = `Refusing to persist invalid DB: ${validation.reason}`;
      console.error('[NotificationStorage]', msg);
      this.lastPersistError = msg;
      throw new Error(msg);
    }

    const content = JSON.stringify(this.db, null, 2);

    // Write + fsync temp file → atomic rename → primary.
    const tmpPath = this.dbPath + '.tmp.' + crypto.randomBytes(4).toString('hex');
    try {
      fs.writeFileSync(tmpPath, content, { encoding: 'utf-8' });
      try {
        const fd = fs.openSync(tmpPath, 'r');
        try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      } catch {
        // fsync is optional best-effort; rename is still atomic on most FS.
      }
      fs.renameSync(tmpPath, this.dbPath);
    } catch (e) {
      this.lastPersistError = (e as Error).message;
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      console.error('[NotificationStorage] Primary persist failed:', e);
      throw e;
    }

    // --- Rolling backups: write a fresh .bak.1 and rotate the rest. ---
    try {
      this.rotateBackups(content);
    } catch (e) {
      // Backup failure is non-fatal — primary is already on disk.
      console.error('[NotificationStorage] Backup rotation failed:', e);
    }

    this.lastPersistAt = Date.now();
    this.lastPersistError = null;
  }

  private rotateBackups(content: string): void {
    const base = this.dbPath;

    // Shift .bak.N → .bak.(N+1), and drop any past MAX_ROLLING_BACKUPS.
    for (let i = MAX_ROLLING_BACKUPS - 1; i >= 1; i--) {
      const src = `${base}${BACKUP_EXT}.${i}`;
      const dst = `${base}${BACKUP_EXT}.${i + 1}`;
      if (fs.existsSync(src)) {
        fs.renameSync(src, dst);
      }
    }
    // Drop the oldest backup that we just pushed past the limit.
    const overflow = `${base}${BACKUP_EXT}.${MAX_ROLLING_BACKUPS + 1}`;
    if (fs.existsSync(overflow)) {
      try { fs.unlinkSync(overflow); } catch { /* ignore */ }
    }

    // Write the fresh .bak.1.
    const fresh = `${base}${BACKUP_EXT}.1`;
    fs.writeFileSync(fresh, content, { encoding: 'utf-8' });
    try {
      const fd = fs.openSync(fresh, 'r');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    } catch {
      // optional
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Public accessors                                                    */
  /* ------------------------------------------------------------------ */

  getDB(): NotificationsDB {
    return this.db;
  }

  getRecoveryInfo(): LoadRecoveryInfo {
    return { ...this.recovery, errors: [...this.recovery.errors] };
  }

  getDiagnostics(): StorageDiagnostics {
    const backups = this.collectBackups().map(b => ({
      path: b.path,
      size: fs.existsSync(b.path) ? fs.statSync(b.path).size : 0,
      modifiedAt: b.mtime,
    }));

    return {
      recovery: this.getRecoveryInfo(),
      primaryPath: this.dbPath,
      backups,
      lastPersistAt: this.lastPersistAt,
      lastPersistError: this.lastPersistError,
    };
  }

  close(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      this.persistInternal();
    } catch (e) {
      console.error('[NotificationStorage] close() persist failed:', e);
    }
  }
}
