import { describe, expect, it } from 'vitest';
import { parseAccessToken } from '../src/lib/jwt.js';

function makeToken(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.sig`;
}

describe('parseAccessToken', () => {
  it('extracts account, client, email, and expiry claims', () => {
    const token = makeToken({
      account_id: 'fallback-account',
      'https://api.openai.com/auth': {
        chatgpt_account_id: '6eb2cacc-2f09-4af5-aa15-f17ec8b66db2',
      },
      client_id: 'client-123',
      email: 'user@example.com',
      exp: 1_900_000_000,
    });

    const claims = parseAccessToken(token);

    expect(claims.accountId).toBe('6eb2cacc-2f09-4af5-aa15-f17ec8b66db2');
    expect(claims.clientId).toBe('client-123');
    expect(claims.email).toBe('user@example.com');
    expect(claims.expiresAt?.toISOString()).toBe('2030-03-17T17:46:40.000Z');
  });

  it('returns empty claims for malformed tokens', () => {
    expect(parseAccessToken('bad-token')).toEqual({
      accountId: '',
      clientId: '',
      email: '',
      expiresAt: undefined,
    });
  });
});
