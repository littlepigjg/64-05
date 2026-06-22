export type RegistryType = 'npm' | 'pypi';

export type PackageSource = 'cache' | 'private' | 'upstream';

export interface PackageInfo {
  name: string;
  registry: RegistryType;
  source: PackageSource;
  versions: PackageVersion[];
  latestVersion: string;
  description?: string;
  author?: string;
  license?: string;
  scope?: string;
  createdAt: number;
  updatedAt: number;
  totalSize: number;
  downloadCount: number;
}

export interface PackageVersion {
  version: string;
  size: number;
  filePath: string;
  sha1?: string;
  publishedAt: number;
  downloadCount: number;
}

export interface CacheStats {
  totalPackages: number;
  totalVersions: number;
  totalSize: number;
  npmPackages: number;
  pypiPackages: number;
  privatePackages: number;
  cachePackages: number;
  maxSize: number;
  usagePercent: number;
}

export interface StorageTrend {
  date: string;
  size: number;
  packages: number;
}

export interface CachePolicy {
  maxSizeGB: number;
  maxAgeDays: number;
  autoClean: boolean;
}

export type NotificationType = 'package_update';

export interface PackageUpdateData {
  packageName: string;
  registry: RegistryType;
  oldVersion: string;
  newVersion: string;
  description?: string;
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  data: PackageUpdateData;
  read: boolean;
  createdAt: number;
}

export interface NotificationSettings {
  enabled: boolean;
  soundEnabled: boolean;
  showUpdates: boolean;
}

export interface WSMessage {
  type: 'notification' | 'ping' | 'pong' | 'history' | 'mark_read' | 'settings' | 'history_response' | 'settings_update';
  payload?: any;
}
