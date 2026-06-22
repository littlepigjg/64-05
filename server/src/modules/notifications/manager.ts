import { config } from '../../config';
import { NotificationStorage } from './storage';
import type { LoadRecoveryInfo, StorageDiagnostics } from './storage';
import { MAX_NOTIFICATIONS, type NotificationListResult } from './types';
import { getWebSocketServer } from '../websocket';
import type { Notification, PackageUpdateData } from '../../types';

export class NotificationManager {
  private storage: NotificationStorage;

  constructor(dataDir: string) {
    this.storage = new NotificationStorage(dataDir);
  }

  /**
   * Create a package-update notification.
   *
   * The record is persisted to disk SYNCHRONOUSLY before the WebSocket
   * broadcast is dispatched, guaranteeing that even if the process crashes
   * in the next millisecond the notification is already durable on disk
   * and will reappear in history after a restart.
   */
  createPackageUpdateNotification(data: PackageUpdateData): Notification {
    const notification: Notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      type: 'package_update',
      title: `${data.packageName} 有新版本可用`,
      message: `版本 ${data.oldVersion} → ${data.newVersion}`,
      data,
      read: false,
      createdAt: Date.now(),
    };

    const db = this.storage.getDB();
    db.notifications.unshift(notification);
    if (db.notifications.length > MAX_NOTIFICATIONS) {
      db.notifications = db.notifications.slice(0, MAX_NOTIFICATIONS);
    }

    // CRITICAL: persist to disk BEFORE broadcasting so the record
    // survives a crash that happens right after this line.
    this.storage.persistNow();

    // Only broadcast after the record is durable.
    this.broadcastNotification(notification);

    return notification;
  }

  private broadcastNotification(notification: Notification): void {
    try {
      // Lazy call: getWebSocketServer is resolved at call time, not at
      // module load, so the circular dependency with the websocket module
      // is safe.
      getWebSocketServer().broadcastNotification(notification);
    } catch {
      // WebSocket server may not be initialized yet — notification is
      // still safely persisted and will be served via REST history.
    }
  }

  getNotifications(limit: number = 100, offset: number = 0): NotificationListResult {
    const db = this.storage.getDB();
    const notifications = db.notifications.slice(offset, offset + limit);
    const total = db.notifications.length;
    const unreadCount = db.notifications.filter(n => !n.read).length;
    return { notifications, total, unreadCount };
  }

  markAsRead(notificationId: string): boolean {
    const db = this.storage.getDB();
    const notification = db.notifications.find(n => n.id === notificationId);
    if (notification) {
      notification.read = true;
      this.storage.persistNow();
      return true;
    }
    return false;
  }

  markAllAsRead(): number {
    const db = this.storage.getDB();
    let count = 0;
    for (const n of db.notifications) {
      if (!n.read) {
        n.read = true;
        count++;
      }
    }
    if (count > 0) {
      this.storage.persistNow();
    }
    return count;
  }

  deleteNotification(notificationId: string): boolean {
    const db = this.storage.getDB();
    const idx = db.notifications.findIndex(n => n.id === notificationId);
    if (idx >= 0) {
      db.notifications.splice(idx, 1);
      this.storage.persistNow();
      return true;
    }
    return false;
  }

  clearAll(): number {
    const db = this.storage.getDB();
    const count = db.notifications.length;
    db.notifications = [];
    this.storage.persistNow();
    return count;
  }

  getLastCheckedVersion(packageKey: string): string | null {
    return this.storage.getDB().versionCheckResults[packageKey]?.version || null;
  }

  setLastCheckedVersion(packageKey: string, version: string): void {
    const db = this.storage.getDB();
    db.versionCheckResults[packageKey] = {
      version,
      checkedAt: Date.now(),
    };
    db.lastChecked = Date.now();
    this.storage.persistNow();
  }

  getLastCheckedTime(): number {
    return this.storage.getDB().lastChecked;
  }

  close(): void {
    this.storage.close();
  }

  /** Information about how the DB was loaded (backup recovery, etc.). */
  getRecoveryInfo(): LoadRecoveryInfo {
    return this.storage.getRecoveryInfo();
  }

  /** Full diagnostics: recovery info + backup listing + last-persist state. */
  getDiagnostics(): StorageDiagnostics {
    return this.storage.getDiagnostics();
  }
}

let notificationManagerInstance: NotificationManager | null = null;

export function getNotificationManager(): NotificationManager {
  if (!notificationManagerInstance) {
    notificationManagerInstance = new NotificationManager(config.dataDir);
  }
  return notificationManagerInstance;
}
