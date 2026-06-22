import type { Notification } from '../../types';

export interface NotificationsDB {
  notifications: Notification[];
  lastChecked: number;
  versionCheckResults: Record<string, { version: string; checkedAt: number }>;
}

export interface NotificationListResult {
  notifications: Notification[];
  total: number;
  unreadCount: number;
}

export const MAX_NOTIFICATIONS = 500;
