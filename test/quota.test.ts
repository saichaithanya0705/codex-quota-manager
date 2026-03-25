import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchUsage } from '../src/lib/quota.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe('fetchUsage', () => {
  it('maps the wham usage payload into app data', async () => {
    global.fetch = vi.fn().mockResolvedValue({
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

    const usage = await fetchUsage('token', 'account-id');

    expect(usage.planType).toBe('plus');
    expect(usage.allowed).toBe(true);
    expect(usage.limitReached).toBe(false);
    expect(usage.windows).toHaveLength(2);
    expect(usage.windows[0]?.label).toBe('5 hour usage limit');
    expect(usage.windows[1]?.label).toBe('Weekly usage limit');
  });
});
