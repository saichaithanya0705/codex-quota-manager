import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, UsageData } from '../src/lib/models.js';

const {
  refreshAccessTokenMock,
  isExpiredMock,
  fetchUsageMock,
  isUnauthorizedQuotaErrorMock,
} = vi.hoisted(() => ({
  refreshAccessTokenMock: vi.fn(),
  isExpiredMock: vi.fn(),
  fetchUsageMock: vi.fn(),
  isUnauthorizedQuotaErrorMock: vi.fn(),
}));

vi.mock('../src/lib/auth.js', () => ({
  refreshAccessToken: refreshAccessTokenMock,
  isExpired: isExpiredMock,
}));

vi.mock('../src/lib/quota.js', () => ({
  fetchUsage: fetchUsageMock,
  isUnauthorizedQuotaError: isUnauthorizedQuotaErrorMock,
}));

import { formatBulkRefreshStatus, refreshAccountUsage } from '../src/lib/account-refresh.js';

function createUsage(): UsageData {
  return {
    planType: 'team',
    allowed: true,
    limitReached: false,
    fetchedAt: new Date('2030-01-01T00:00:00.000Z'),
    windows: [
      {
        label: '5 hour usage limit',
        usedPercent: 42,
        leftPercent: 58,
        resetAt: new Date('2030-01-01T05:00:00.000Z'),
        windowSec: 18_000,
      },
    ],
  };
}

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    key: 'acct-1',
    label: 'Primary Account',
    email: 'primary@example.com',
    accountId: '11111111-1111-4111-8111-111111111111',
    idToken: 'id-token',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    clientId: 'client-id',
    source: 'managed',
    filePath: '',
    writable: true,
    sources: ['managed'],
    activeTargets: [],
    ...overrides,
  };
}

beforeEach(() => {
  refreshAccessTokenMock.mockReset();
  isExpiredMock.mockReset();
  fetchUsageMock.mockReset();
  isUnauthorizedQuotaErrorMock.mockReset();

  isExpiredMock.mockReturnValue(false);
  isUnauthorizedQuotaErrorMock.mockReturnValue(false);
});

describe('refreshAccountUsage', () => {
  it('clears stale usage when token refresh fails before quota fetch', async () => {
    const account = createAccount({ usage: createUsage() });
    const refreshError = new Error('Refresh token failed.');

    isExpiredMock.mockReturnValue(true);
    refreshAccessTokenMock.mockRejectedValue(refreshError);

    await expect(refreshAccountUsage(account)).rejects.toThrow('Refresh token failed.');
    expect(account.usage).toBeUndefined();
    expect(account.lastError).toBe('Refresh token failed.');
  });

  it('retries after an unauthorized quota response and succeeds', async () => {
    const account = createAccount();
    const usage = createUsage();
    const unauthorizedError = new Error('Quota request failed with status 401');

    fetchUsageMock
      .mockRejectedValueOnce(unauthorizedError)
      .mockResolvedValueOnce(usage);
    isUnauthorizedQuotaErrorMock.mockImplementation((error: unknown) => error === unauthorizedError);

    const result = await refreshAccountUsage(account);

    expect(result).toEqual({ tokenUpdated: true });
    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(fetchUsageMock).toHaveBeenCalledTimes(2);
    expect(account.usage).toEqual(usage);
    expect(account.lastError).toBeUndefined();
  });

  it('clears stale usage when the retry path also fails', async () => {
    const account = createAccount({ usage: createUsage() });
    const unauthorizedError = new Error('Quota request failed with status 403');
    const retryError = new Error('Refresh token expired.');

    fetchUsageMock.mockRejectedValueOnce(unauthorizedError);
    isUnauthorizedQuotaErrorMock.mockImplementation((error: unknown) => error === unauthorizedError);
    refreshAccessTokenMock.mockRejectedValueOnce(retryError);

    await expect(refreshAccountUsage(account)).rejects.toThrow('Refresh token expired.');
    expect(account.usage).toBeUndefined();
    expect(account.lastError).toBe('Refresh token expired.');
  });
});

describe('formatBulkRefreshStatus', () => {
  it('reports partial failures truthfully', () => {
    expect(formatBulkRefreshStatus(5, 2)).toBe('Refreshed 3 accounts, 2 failed.');
  });
});
