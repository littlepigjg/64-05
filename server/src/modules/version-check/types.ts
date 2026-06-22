import type { RegistryType } from '../../types';

export interface VersionCheckResult {
  packageName: string;
  registry: RegistryType;
  oldVersion: string;
  newVersion: string;
  hasUpdate: boolean;
}
