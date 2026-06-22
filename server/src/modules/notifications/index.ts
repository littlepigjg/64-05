import fs from 'fs';
import path from 'path';
import { ensureDir } from '../../utils';
import { config } from '../../config';
import { getWebSocketServer } from '../websocket';
import type { Notification, PackageUpdateData } from '../../types';

interface NotificationsDB {
  notifications: Notification[];
  lastChecked: number;
  versionCheckResults: Record<string, { version: string; checkedAt: number }>;
}

const MAX_NOTIFICATIONS = 500;

export class NotificationManager {
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

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persist();
    }, 200);
  }

  private persist(): void {
    ensureDir(this.dataDir);
    const tmpPath = this.dbPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(this.db, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.dbPath);
  }

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

    this.db.notifications.unshift(notification);
    if (this.db.notifications.length > MAX_NOTIFICATIONS) {
      this.db.notifications = this.db.notifications.slice(0, MAX_NOTIFICATIONS);
    }
    this.scheduleSave();

    try {
      const wsServer = getWebSocketServer();
      wsServer.broadcastNotification(notification);
    } catch (e) {
      // WebSocket server may not be initialized yet
    }

    return notification;
  }

  getNotifications(limit: number = 100, offset: number = 0): { notifications: Notification[]; total: number; unreadCount: number } {
    const notifications = this.db.notifications.slice(offset, offset + limit);
    const total = this.db.notifications.length;
    const unreadCount = this.db.notifications.filter(n => !n.read).length;
    return { notifications, total, unreadCount };
  }

  markAsRead(notificationId: string): boolean {
    const notification = this.db.notifications.find(n => n.id === notificationId);
    if (notification) {
      notification.read = true;
      this.scheduleSave();
      return true;
    }
    return false;
  }

  markAllAsRead(): number {
    let count = 0;
    for (const n of this.db.notifications) {
      if (!n.read) {
        n.read = true;
        count++;
      }
    }
    if (count > 0) {
      this.scheduleSave();
    }
    return count;
  }

  deleteNotification(notificationId: string): boolean {
    const idx = this.db.notifications.findIndex(n => n.id === notificationId);
    if (idx >= 0) {
      this.db.notifications.splice(idx, 1);
      this.scheduleSave();
      return true;
    }
    return false;
  }

  clearAll(): number {
    const count = this.db.notifications.length;
    this.db.notifications = [];
    this.scheduleSave();
    return count;
  }

  getLastCheckedVersion(packageKey: string): string | null {
    return this.db.versionCheckResults[packageKey]?.version || null;
  }

  setLastCheckedVersion(packageKey: string, version: string): void {
    this.db.versionCheckResults[packageKey] = {
      version,
      checkedAt: Date.now(),
    };
    this.db.lastChecked = Date.now();
    this.scheduleSave();
  }

  getLastCheckedTime(): number {
    return this.db.lastChecked;
  }

  close(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.persist();
  }
}

let notificationManagerInstance: NotificationManager | null = null;

export function getNotificationManager(): NotificationManager {
  if (!notificationManagerInstance) {
    notificationManagerInstance = new NotificationManager(config.dataDir);
  }
  return notificationManagerInstance;
}
