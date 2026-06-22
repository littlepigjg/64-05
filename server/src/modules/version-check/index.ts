import { getMetadataIndex } from '../metadata';
import { getNotificationManager } from '../notifications';
import { config } from '../../config';
import { makeRequest } from '../proxy/utils';
import semver from 'semver';
import type { RegistryType, PackageInfo } from '../../types';

interface VersionCheckResult {
  packageName: string;
  registry: RegistryType;
  oldVersion: string;
  newVersion: string;
  hasUpdate: boolean;
}

export class VersionChecker {
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private checkIntervalMs: number;

  constructor(checkIntervalMinutes: number = 60) {
    this.checkIntervalMs = checkIntervalMinutes * 60 * 1000;
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

  private async checkAllPackages(): Promise<VersionCheckResult[]> {
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
    const latestUpstreamVersion = await this.getLatestUpstreamVersion(pkg.name, pkg.registry);

    const hasUpdate = latestUpstreamVersion && semver.valid(latestUpstreamVersion) &&
      semver.valid(pkg.latestVersion) &&
      semver.gt(latestUpstreamVersion, pkg.latestVersion);

    return {
      packageName: pkg.name,
      registry: pkg.registry,
      oldVersion: pkg.latestVersion,
      newVersion: latestUpstreamVersion || pkg.latestVersion,
      hasUpdate: !!hasUpdate,
    };
  }

  private async getLatestUpstreamVersion(packageName: string, registry: RegistryType): Promise<string | null> {
    try {
      if (registry === 'npm') {
        const url = `${config.npm.upstream}/${encodeURIComponent(packageName)}`;
        const response = await makeRequest(url, { timeout: 10000 });
        if (response.statusCode === 200) {
          const data = JSON.parse(response.body.toString('utf-8'));
          return data['dist-tags']?.latest || null;
        }
      } else if (registry === 'pypi') {
        const url = `${config.pypi.upstream}/pypi/${encodeURIComponent(packageName)}/json`;
        const response = await makeRequest(url, { timeout: 10000 });
        if (response.statusCode === 200) {
          const data = JSON.parse(response.body.toString('utf-8'));
          return data.info?.version || null;
        }
      }
    } catch (e) {
      // Package may not exist or network error, return null
    }
    return null;
  }

  async checkSinglePackage(packageName: string, registry: RegistryType): Promise<VersionCheckResult | null> {
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
