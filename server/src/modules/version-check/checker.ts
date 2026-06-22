import semver from 'semver';
import { getMetadataIndex } from '../metadata';
import { getNotificationManager } from '../notifications';
import { RegistryFetcher } from './registry-fetcher';
import type { PackageInfo } from '../../types';
import type { VersionCheckResult } from './types';

/**
 * Periodically checks cached packages against their upstream registry
 * and creates a notification (persisted + broadcast) when a newer
 * version is found.
 */
export class VersionChecker {
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private checkIntervalMs: number;
  private fetcher: RegistryFetcher;

  constructor(checkIntervalMinutes: number = 60, fetcher?: RegistryFetcher) {
    this.checkIntervalMs = checkIntervalMinutes * 60 * 1000;
    this.fetcher = fetcher || new RegistryFetcher();
  }

  start(): void {
    if (this.checkInterval) return;

    setTimeout(() => {
      this.checkAllPackages().catch(console.error);
    }, 10000);

    this.checkInterval = setInterval(() => {
      this.checkAllPackages().catch(console.error);
    }, this.checkIntervalMs);

    console.log(`[VersionChecker] Started, checking every ${this.checkIntervalMs / 60000} minutes`);
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    console.log('[VersionChecker] Stopped');
  }

  async checkAllPackages(): Promise<VersionCheckResult[]> {
    if (this.isRunning) return [];
    this.isRunning = true;

    const results: VersionCheckResult[] = [];
    const metadata = getMetadataIndex();
    const notificationManager = getNotificationManager();

    try {
      const { packages } = metadata.listPackages({ source: 'cache', limit: 1000 });
      console.log(`[VersionChecker] Checking ${packages.length} cached packages for updates...`);

      for (const pkg of packages) {
        try {
          const result = await this.checkPackage(pkg);
          if (result.hasUpdate) {
            const packageKey = `${pkg.registry}:${pkg.name}`;
            const lastChecked = notificationManager.getLastCheckedVersion(packageKey);

            if (lastChecked !== result.newVersion) {
              notificationManager.createPackageUpdateNotification({
                packageName: result.packageName,
                registry: result.registry,
                oldVersion: result.oldVersion,
                newVersion: result.newVersion,
                description: pkg.description,
              });
              notificationManager.setLastCheckedVersion(packageKey, result.newVersion);
              results.push(result);
              console.log(`[VersionChecker] Update found: ${pkg.name} ${result.oldVersion} -> ${result.newVersion}`);
            }
          }
        } catch (e) {
          console.warn(`[VersionChecker] Failed to check ${pkg.name}:`, (e as Error).message);
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log(`[VersionChecker] Check complete, ${results.length} updates found`);
    } finally {
      this.isRunning = false;
    }

    return results;
  }

  private async checkPackage(pkg: PackageInfo): Promise<VersionCheckResult> {
    const latestUpstreamVersion = await this.fetcher.getLatestVersion(pkg.name, pkg.registry);

    const hasUpdate = !!(
      latestUpstreamVersion &&
      semver.valid(latestUpstreamVersion) &&
      semver.valid(pkg.latestVersion) &&
      semver.gt(latestUpstreamVersion, pkg.latestVersion)
    );

    return {
      packageName: pkg.name,
      registry: pkg.registry,
      oldVersion: pkg.latestVersion,
      newVersion: latestUpstreamVersion || pkg.latestVersion,
      hasUpdate,
    };
  }

  async checkSinglePackage(packageName: string, registry: PackageInfo['registry']): Promise<VersionCheckResult | null> {
    const metadata = getMetadataIndex();
    const pkg = metadata.getPackage(packageName, registry);
    if (!pkg) return null;
    return this.checkPackage(pkg);
  }

  async forceCheck(): Promise<VersionCheckResult[]> {
    return this.checkAllPackages();
  }
}

let versionCheckerInstance: VersionChecker | null = null;

export function getVersionChecker(): VersionChecker {
  if (!versionCheckerInstance) {
    versionCheckerInstance = new VersionChecker(60);
  }
  return versionCheckerInstance;
}
