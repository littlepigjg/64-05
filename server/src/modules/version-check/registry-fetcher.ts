import { config } from '../../config';
import { makeRequest } from '../proxy/utils';
import type { RegistryType } from '../../types';

/**
 * Fetches the latest published version of a package from its upstream
 * registry. Extracted as a standalone class so it can be reused or
 * mocked independently of the checker orchestration.
 */
export class RegistryFetcher {
  async getLatestVersion(packageName: string, registry: RegistryType): Promise<string | null> {
    try {
      if (registry === 'npm') {
        return await this.getNpmLatest(packageName);
      } else if (registry === 'pypi') {
        return await this.getPyPILatest(packageName);
      }
    } catch {
      // Package may not exist or network error, return null
    }
    return null;
  }

  private async getNpmLatest(packageName: string): Promise<string | null> {
    const url = `${config.npm.upstream}/${encodeURIComponent(packageName)}`;
    const response = await makeRequest(url, { timeout: 10000 });
    if (response.statusCode === 200) {
      const data = JSON.parse(response.body.toString('utf-8'));
      return data['dist-tags']?.latest || null;
    }
    return null;
  }

  private async getPyPILatest(packageName: string): Promise<string | null> {
    const url = `${config.pypi.upstream}/pypi/${encodeURIComponent(packageName)}/json`;
    const response = await makeRequest(url, { timeout: 10000 });
    if (response.statusCode === 200) {
      const data = JSON.parse(response.body.toString('utf-8'));
      return data.info?.version || null;
    }
    return null;
  }
}
