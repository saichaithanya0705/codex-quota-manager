import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Account } from '../src/lib/models.js';
import { applyAccountToTargets, loadAccounts } from '../src/lib/store.js';

const envKeys = ['CQ_CONFIG_HOME', 'CODEX_AUTH_PATH', 'OPENCODE_AUTH_PATH'] as const;
const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

function makeToken(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.sig`;
}

afterEach(async () => {
  for (const key of envKeys) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('loadAccounts', () => {
  it('merges managed, Codex, and OpenCode identities into one canonical account', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cqm-store-test-'));
    const configHome = path.join(tempRoot, 'config');
    const codexAuthPath = path.join(tempRoot, 'codex', 'auth.json');
    const openCodeAuthPath = path.join(tempRoot, 'opencode', 'auth.json');

    const olderToken = makeToken({
      account_id: 'c1a1c1a1-c1a1-4c1a-a1c1-1c1a1c1a1c1a',
      client_id: 'client-old',
      email: 'person@example.com',
      exp: 1_900_000_000,
    });
    const newerToken = makeToken({
      account_id: 'c1a1c1a1-c1a1-4c1a-a1c1-1c1a1c1a1c1a',
      client_id: 'client-new',
      email: 'person@example.com',
      exp: 1_900_100_000,
    });

    await fs.mkdir(path.dirname(codexAuthPath), { recursive: true });
    await fs.mkdir(path.dirname(openCodeAuthPath), { recursive: true });
    await fs.mkdir(configHome, { recursive: true });

    await fs.writeFile(
      path.join(configHome, 'accounts.json'),
      JSON.stringify({
        accounts: [
          {
            label: 'Managed',
            email: 'person@example.com',
            account_id: 'c1a1c1a1-c1a1-4c1a-a1c1-1c1a1c1a1c1a',
            id_token: 'managed-id-token',
            access_token: olderToken,
            refresh_token: 'refresh-old',
            client_id: 'client-old',
            expires_at_ms: new Date('2030-03-17T17:46:40.000Z').getTime(),
          },
        ],
      }),
    );

    await fs.writeFile(
      codexAuthPath,
      JSON.stringify({
        tokens: {
          id_token: 'codex-id-token',
          access_token: newerToken,
          refresh_token: 'refresh-new',
          account_id: 'c1a1c1a1-c1a1-4c1a-a1c1-1c1a1c1a1c1a',
        },
      }),
    );

    await fs.writeFile(
      openCodeAuthPath,
      JSON.stringify({
        openai: {
          access: newerToken,
          refresh: 'refresh-new',
          accountId: 'c1a1c1a1-c1a1-4c1a-a1c1-1c1a1c1a1c1a',
          email: 'person@example.com',
          expires: new Date('2030-03-18T21:33:20.000Z').getTime(),
        },
      }),
    );

    process.env.CQ_CONFIG_HOME = configHome;
    process.env.CODEX_AUTH_PATH = codexAuthPath;
    process.env.OPENCODE_AUTH_PATH = openCodeAuthPath;

    const accounts = await loadAccounts();

    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.sources.sort()).toEqual(['codex', 'managed', 'opencode']);
    expect(accounts[0]?.activeTargets.sort()).toEqual(['codex', 'opencode']);
    expect(accounts[0]?.clientId).toBe('client-new');
    expect(accounts[0]?.idToken).toBe('codex-id-token');

    const savedStore = JSON.parse(await fs.readFile(path.join(configHome, 'accounts.json'), 'utf8')) as {
      accounts: Array<{ client_id?: string; id_token?: string; access_token: string }>;
    };
    expect(savedStore.accounts[0]?.client_id).toBe('client-new');
    expect(savedStore.accounts[0]?.id_token).toBe('codex-id-token');
    expect(savedStore.accounts[0]?.access_token).toBe(newerToken);
  });
});

describe('applyAccountToTargets', () => {
  it('writes a complete Codex auth payload for the selected account', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cqm-apply-test-'));
    const codexAuthPath = path.join(tempRoot, 'codex', 'auth.json');

    await fs.mkdir(path.dirname(codexAuthPath), { recursive: true });
    await fs.writeFile(
      codexAuthPath,
      JSON.stringify({
        auth_mode: 'chatgpt',
        OPENAI_API_KEY: null,
        tokens: {
          id_token: 'old-id-token',
          access_token: 'old-access-token',
          refresh_token: 'old-refresh-token',
          account_id: 'old-account-id',
        },
      }),
    );

    process.env.CODEX_AUTH_PATH = codexAuthPath;

    const account: Account = {
      key: 'acct-1',
      label: 'person@example.com',
      email: 'person@example.com',
      accountId: 'new-account-id',
      idToken: 'new-id-token',
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      clientId: 'client-id',
      expiresAt: undefined,
      source: 'managed',
      filePath: '',
      writable: true,
      sources: ['managed'],
      activeTargets: [],
    };

    await applyAccountToTargets(account, ['codex']);

    const written = JSON.parse(await fs.readFile(codexAuthPath, 'utf8')) as {
      auth_mode?: string;
      OPENAI_API_KEY?: unknown;
      tokens?: {
        id_token?: string;
        access_token?: string;
        refresh_token?: string;
        account_id?: string;
      };
      last_refresh?: string;
    };

    expect(written.auth_mode).toBe('chatgpt');
    expect(written.OPENAI_API_KEY).toBeNull();
    expect(written.tokens?.id_token).toBe('new-id-token');
    expect(written.tokens?.access_token).toBe('new-access-token');
    expect(written.tokens?.refresh_token).toBe('new-refresh-token');
    expect(written.tokens?.account_id).toBe('new-account-id');
    expect(written.last_refresh).toBeTruthy();
  });
});
