import type {
  PackageListResponse,
  PackageInfo,
  CacheStats,
  StorageTrend,
  CachePolicy,
  HealthInfo,
  RegistryType,
  PackageSource,
  Notification,
  NotificationListResponse,
  NotificationSettings,
} from './types';

const API_BASE = '/api';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  health: () => request<HealthInfo>('/health'),

  getScopes: () => request<{ scopes: string[] }>('/scopes'),

  listPackages: (params: {
    registry?: RegistryType;
    source?: PackageSource;
    search?: string;
    limit?: number;
    offset?: number;
    sortBy?: 'name' | 'updatedAt' | 'size' | 'downloads';
    sortOrder?: 'asc' | 'desc';
  } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) qs.set(k, String(v));
    });
    return request<PackageListResponse>(`/packages?${qs.toString()}`);
  },

  getPackage: (registry: RegistryType, name: string) =>
    request<PackageInfo>(`/packages/${registry}/${encodeURIComponent(name)}`),

  deletePackage: (registry: RegistryType, name: string) =>
    request<{ success: boolean; deleted: string }>(
      `/packages/${registry}/${encodeURIComponent(name)}`,
      { method: 'DELETE' }
    ),

  deleteVersion: (registry: RegistryType, name: string, version: string) =>
    request<{ success: boolean; deleted: string }>(
      `/packages/${registry}/${encodeURIComponent(name)}/versions/${version}`,
      { method: 'DELETE' }
    ),

  cleanupUnused: (registry: RegistryType, name: string, keep: number = 3) =>
    request<{ success: boolean; kept: number; deleted: string[] }>(
      `/packages/${registry}/${encodeURIComponent(name)}/cleanup-unused?keep=${keep}`,
      { method: 'POST' }
    ),

  getStats: () => request<CacheStats>('/stats'),

  getTrend: (days: number = 30) =>
    request<StorageTrend[]>(`/stats/trend?days=${days}`),

  getCachePolicy: () => request<CachePolicy>('/cache/policy'),

  updateCachePolicy: (policy: CachePolicy) =>
    request<{ success: boolean; policy: CachePolicy }>('/cache/policy', {
      method: 'PUT',
      body: JSON.stringify(policy),
    }),

  runCleanup: () =>
    request<{ success: boolean; deletedFiles: number; freedBytes: number }>(
      '/cache/cleanup',
      { method: 'POST' }
    ),

  snapshot: () =>
    request<{ success: boolean; timestamp: number }>('/cache/snapshot', {
      method: 'POST',
    }),

  getNotifications: (params: { limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.offset !== undefined) qs.set('offset', String(params.offset));
    const query = qs.toString();
    return request<NotificationListResponse>(`/notifications${query ? `?${query}` : ''}`);
  },

  markNotificationRead: (id: string) =>
    request<{ success: boolean }>(`/notifications/${id}/read`, {
      method: 'POST',
    }),

  markAllNotificationsRead: () =>
    request<{ success: boolean; count: number }>('/notifications/read-all', {
      method: 'POST',
    }),

  deleteNotification: (id: string) =>
    request<{ success: boolean }>(`/notifications/${id}`, {
      method: 'DELETE',
    }),

  clearAllNotifications: () =>
    request<{ success: boolean; count: number }>('/notifications', {
      method: 'DELETE',
    }),

  forceCheckUpdates: () =>
    request<{ success: boolean; updates: Array<{ packageName: string; registry: RegistryType; oldVersion: string; newVersion: string }> }>('/notifications/force-check', {
      method: 'POST',
    }),

  getNotificationSettings: (): NotificationSettings => {
    const stored = localStorage.getItem('notificationSettings');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // fall through
      }
    }
    return {
      enabled: true,
      soundEnabled: false,
      showUpdates: true,
    };
  },

  saveNotificationSettings: (settings: NotificationSettings): void => {
    localStorage.setItem('notificationSettings', JSON.stringify(settings));
  },
};
