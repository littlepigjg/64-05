import { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { getWebSocketService, initWebSocketService } from '../services/websocket';
import { api } from '../api';
import { mergeNotifications, appendUnique } from '../utils/notifications';
import type { Notification, NotificationListResponse, NotificationSettings } from '../types';

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  totalCount: number;
  connectionState: 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
  settings: NotificationSettings;
  isLoading: boolean;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  updateSettings: (settings: Partial<NotificationSettings>) => void;
  loadMore: (limit?: number) => Promise<void>;
  forceCheck: () => Promise<void>;
  activeToast: Notification | null;
  dismissToast: () => void;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected' | 'reconnecting'>('disconnected');
  const [settings, setSettings] = useState<NotificationSettings>({ enabled: true, soundEnabled: false, showUpdates: true });
  const [isLoading, setIsLoading] = useState(true);
  const [activeToast, setActiveToast] = useState<Notification | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const initializedRef = useRef(false);

  // Derived: unread count is always computed from the source of truth
  // (the notifications array) so it can never drift out of sync.
  const unreadCount = useMemo(
    () => notifications.filter(n => !n.read).length,
    [notifications]
  );

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setActiveToast(null);
  }, []);

  const showToast = useCallback((notification: Notification) => {
    if (!settings.enabled || !settings.showUpdates) return;

    setActiveToast(notification);

    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }

    toastTimerRef.current = window.setTimeout(() => {
      setActiveToast(null);
      toastTimerRef.current = null;
    }, 8000);

    if (settings.soundEnabled) {
      try {
        const audio = new Audio('/notification-sound.mp3');
        audio.volume = 0.5;
        audio.play().catch(() => {});
      } catch {
        // ignore
      }
    }
  }, [settings]);

  const handleNotification = useCallback((notification: Notification) => {
    // Prepend the new notification. Using mergeNotifications with a
    // single-element array deduplicates in case the same notification
    // arrives twice (e.g. WS + REST race).
    setNotifications(prev => mergeNotifications([notification], prev));
    setTotalCount(prev => prev + 1);
    showToast(notification);
  }, [showToast]);

  const handleHistoryUpdate = useCallback((data: NotificationListResponse) => {
    // MERGE instead of replace: server data overlays local state, but
    // local-only notifications (received via WS but not yet in a
    // server history response) are preserved so they never "flash"
    // and disappear.
    setNotifications(prev => mergeNotifications(prev, data.notifications));
    setTotalCount(data.total);
    setIsLoading(false);
  }, []);

  const handleConnectionChange = useCallback((state: 'connecting' | 'connected' | 'disconnected' | 'reconnecting') => {
    setConnectionState(state);
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    setSettings(api.getNotificationSettings());

    const wsService = initWebSocketService({
      onNotification: handleNotification,
      onHistoryUpdate: handleHistoryUpdate,
      onConnectionChange: handleConnectionChange,
    });

    wsService.connect();

    // Also fetch history via REST — this is the authoritative source
    // and survives even if the WS handshake is slow. Merged with WS
    // notifications so nothing is lost.
    api.getNotifications({ limit: 50 })
      .then(data => {
        setNotifications(prev => mergeNotifications(prev, data.notifications));
        setTotalCount(data.total);
        setIsLoading(false);
      })
      .catch(() => {
        setIsLoading(false);
      });

    return () => {
      wsService.disconnect();
    };
  }, [handleNotification, handleHistoryUpdate, handleConnectionChange]);

  const markAsRead = useCallback(async (id: string) => {
    // Optimistic local update first.
    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, read: true } : n))
    );

    try {
      await api.markNotificationRead(id);
      const ws = getWebSocketService();
      ws.markAsRead(id);
    } catch (e) {
      console.error('Failed to mark notification as read:', e);
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));

    try {
      await api.markAllNotificationsRead();
      const ws = getWebSocketService();
      ws.markAllAsRead();
    } catch (e) {
      console.error('Failed to mark all as read:', e);
    }
  }, []);

  const deleteNotification = useCallback(async (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    setTotalCount(prev => Math.max(0, prev - 1));

    try {
      await api.deleteNotification(id);
    } catch (e) {
      console.error('Failed to delete notification:', e);
    }
  }, []);

  const clearAll = useCallback(async () => {
    setNotifications([]);
    setTotalCount(0);

    try {
      await api.clearAllNotifications();
    } catch (e) {
      console.error('Failed to clear notifications:', e);
    }
  }, []);

  const updateSettings = useCallback((newSettings: Partial<NotificationSettings>) => {
    setSettings(prev => {
      const updated = { ...prev, ...newSettings };
      api.saveNotificationSettings(updated);
      return updated;
    });
  }, []);

  const loadMore = useCallback(async (limit: number = 50) => {
    try {
      const data = await api.getNotifications({ limit, offset: notifications.length });
      // Append with dedup instead of raw spread.
      setNotifications(prev => appendUnique(prev, data.notifications));
      setTotalCount(data.total);
    } catch (e) {
      console.error('Failed to load more notifications:', e);
    }
  }, [notifications.length]);

  const forceCheck = useCallback(async () => {
    try {
      await api.forceCheckUpdates();
      const data = await api.getNotifications({ limit: 50 });
      // Merge — newly created notifications may have arrived via WS
      // during the check; don't clobber them.
      setNotifications(prev => mergeNotifications(prev, data.notifications));
      setTotalCount(data.total);
    } catch (e) {
      console.error('Failed to force check:', e);
    }
  }, []);

  const value: NotificationContextType = {
    notifications,
    unreadCount,
    totalCount,
    connectionState,
    settings,
    isLoading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
    updateSettings,
    loadMore,
    forceCheck,
    activeToast,
    dismissToast,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
