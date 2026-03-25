import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuotaApiError, QuotaTransportError, fetchUsage } from '../src/lib/quota.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe('fetchUsage', () => {
  it('maps the wham usage payload into app data', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        plan_type: 'plus',
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: {
            limit_window_seconds: 18_000,
            used_percent: 42.4,
            reset_at: 1_900_000_000,
          },
          secondary_window: {
            limit_window_seconds: 604_800,
            used_percent: 9.9,
            reset_at: 1_900_100_000,
          },
        },
      }),
    }) as typeof fetch;
    global.fetch = fetchMock;

    const usage = await fetchUsage('token', 'account-id');

    expect(usage.planType).toBe('plus');
    expect(usage.allowed).toBe(true);
    expect(usage.limitReached).toBe(false);
    expect(usage.windows).toHaveLength(2);
    expect(usage.windows[0]?.label).toBe('5 hour usage limit');
    expect(usage.windows[1]?.label).toBe('Weekly usage limit');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/wham/usage',
      expect.objectContaining({
        headers: expect.objectContaining({
          'ChatGPT-Account-Id': 'account-id',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('throws an HTTP error for non-2xx responses', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'forbidden',
    }) as typeof fetch;

    await expect(fetchUsage('token', 'account-id')).rejects.toMatchObject<Partial<QuotaApiError>>({
      statusCode: 403,
      message: 'Quota request failed with status 403: forbidden',
    });
  });

  it('wraps low-level fetch failures as network transport errors', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as typeof fetch;

    await expect(fetchUsage('token', 'account-id')).rejects.toBeInstanceOf(QuotaTransportError);
    await expect(fetchUsage('token', 'account-id')).rejects.toMatchObject<Partial<QuotaTransportError>>({
      kind: 'network',
      message: expect.stringContaining('could not reach chatgpt.com'),
    });
  });

  it('wraps timeout failures with a timeout-specific message', async () => {
    const timeoutError = new Error('The operation timed out');
    timeoutError.name = 'TimeoutError';
    global.fetch = vi.fn().mockRejectedValue(timeoutError) as typeof fetch;

    await expect(fetchUsage('token', 'account-id')).rejects.toMatchObject<Partial<QuotaTransportError>>({
      kind: 'timeout',
      message: 'Quota request timed out after 30 seconds. Check your connection and try again.',
    });
  });
});
