import { isExpired, refreshAccessToken } from './auth.js';
import type { Account } from './models.js';
import { fetchUsage, isUnauthorizedQuotaError } from './quota.js';

export interface RefreshUsageResult {
  tokenUpdated: boolean;
}

export async function refreshAccountUsage(account: Account): Promise<RefreshUsageResult> {
  let tokenUpdated = false;

  try {
    if (isExpired(account) && account.refreshToken.trim()) {
      await refreshAccessToken(account);
      tokenUpdated = true;
    }

    try {
      account.usage = await fetchUsage(account.accessToken, account.accountId);
      account.lastError = undefined;
    } catch (error) {
      if (isUnauthorizedQuotaError(error) && account.refreshToken.trim()) {
        await refreshAccessToken(account);
        tokenUpdated = true;
        account.usage = await fetchUsage(account.accessToken, account.accountId);
        account.lastError = undefined;
      } else {
        throw error;
      }
    }

    return { tokenUpdated };
  } catch (error) {
    account.usage = undefined;
    account.lastError = userFacingError(error);
    throw error;
  }
}

export function formatBulkRefreshStatus(total: number, failed: number): string {
  const refreshed = Math.max(0, total - failed);

  if (total <= 0) {
    return 'No accounts available to refresh.';
  }

  if (failed <= 0) {
    return `Refreshed ${refreshed} account${refreshed === 1 ? '' : 's'}.`;
  }

  return `Refreshed ${refreshed} account${refreshed === 1 ? '' : 's'}, ${failed} failed.`;
}

export function userFacingError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
