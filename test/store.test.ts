import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Account } from '../src/lib/models.js';
import { applyAccountToTargets, deleteManagedAccount, loadAccounts, upsertManagedAccount } from '../src/lib/store.js';

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
  it('does not auto-write discovered external accounts into the manager store', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cqm-load-discovered-test-'));
    const configHome = path.join(tempRoot, 'config');
    const codexAuthPath = path.join(tempRoot, 'codex', 'auth.json');

    await fs.mkdir(path.dirname(codexAuthPath), { recursive: true });
    await fs.mkdir(configHome, { recursive: true });

    await fs.writeFile(
      codexAuthPath,
      JSON.stringify({
        tokens: {
          id_token: 'codex-id-token',
          access_token: makeToken({
            account_id: 'd1a1c1a1-c1a1-4c1a-a1c1-1c1a1c1a1c1a',
            client_id: 'client-discovered',
            email: 'discovered@example.com',
            exp: 1_900_100_000,
          }),
          refresh_token: 'refresh-discovered',
          account_id: 'd1a1c1a1-c1a1-4c1a-a1c1-1c1a1c1a1c1a',
        },
      }),
    );

    process.env.CQ_CONFIG_HOME = configHome;
    process.env.CODEX_AUTH_PATH = codexAuthPath;
    process.env.OPENCODE_AUTH_PATH = path.join(tempRoot, 'missing-opencode-auth.json');

    const accounts = await loadAccounts();

    expect(accounts).toHaveLength(1);
    await expect(fs.readFile(path.join(configHome, 'accounts.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

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
    expect(savedStore.accounts[0]?.client_id).toBe('client-old');
    expect(savedStore.accounts[0]?.id_token).toBe('managed-id-token');
    expect(savedStore.accounts[0]?.access_token).toBe(olderToken);
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
      targetPaths: { codex: codexAuthPath },
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

  it('writes OpenCode auth only to the selected target path', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cqm-opencode-apply-test-'));
    const firstOpenCodeAuthPath = path.join(tempRoot, 'opencode-one', 'auth.json');
    const secondOpenCodeAuthPath = path.join(tempRoot, 'opencode-two', 'auth.json');

    await fs.mkdir(path.dirname(firstOpenCodeAuthPath), { recursive: true });
    await fs.mkdir(path.dirname(secondOpenCodeAuthPath), { recursive: true });
    await fs.writeFile(firstOpenCodeAuthPath, JSON.stringify({ openai: { access: 'old-one' } }));
    await fs.writeFile(secondOpenCodeAuthPath, JSON.stringify({ openai: { access: 'old-two' } }));

    process.env.OPENCODE_AUTH_PATH = firstOpenCodeAuthPath;

    const account: Account = {
      key: 'acct-2',
      label: 'person@example.com',
      email: 'person@example.com',
      accountId: 'new-account-id',
      idToken: 'new-id-token',
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      clientId: 'client-id',
      expiresAt: new Date('2030-03-17T17:46:40.000Z'),
      source: 'managed',
      filePath: '',
      writable: true,
      sources: ['managed', 'opencode'],
      activeTargets: [],
      targetPaths: { opencode: secondOpenCodeAuthPath },
    };

    await applyAccountToTargets(account, ['opencode']);

    const firstWritten = JSON.parse(await fs.readFile(firstOpenCodeAuthPath, 'utf8')) as { openai?: { access?: string } };
    const secondWritten = JSON.parse(await fs.readFile(secondOpenCodeAuthPath, 'utf8')) as {
      openai?: { access?: string; refresh?: string; accountId?: string; email?: string };
    };

    expect(firstWritten.openai?.access).toBe('old-one');
    expect(secondWritten.openai?.access).toBe('new-access-token');
    expect(secondWritten.openai?.refresh).toBe('new-refresh-token');
    expect(secondWritten.openai?.accountId).toBe('new-account-id');
    expect(secondWritten.openai?.email).toBe('person@example.com');
  });

  it('reuses a persisted OpenCode target path after reload', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cqm-opencode-target-reuse-test-'));
    const configHome = path.join(tempRoot, 'config');
    const firstOpenCodeAuthPath = path.join(tempRoot, 'opencode-one', 'auth.json');
    const secondOpenCodeAuthPath = path.join(tempRoot, 'opencode-two', 'auth.json');

    await fs.mkdir(path.dirname(firstOpenCodeAuthPath), { recursive: true });
    await fs.mkdir(path.dirname(secondOpenCodeAuthPath), { recursive: true });
    await fs.mkdir(configHome, { recursive: true });
    await fs.writeFile(firstOpenCodeAuthPath, JSON.stringify({ openai: { access: 'old-one' } }));
    await fs.writeFile(secondOpenCodeAuthPath, JSON.stringify({ openai: { access: 'old-two' } }));

    const storedToken = makeToken({
      account_id: '44444444-4444-4444-8444-444444444444',
      client_id: 'client-id',
      email: 'person@example.com',
      exp: 1_900_100_000,
    });

    await fs.writeFile(
      path.join(configHome, 'accounts.json'),
      JSON.stringify({
        accounts: [
          {
            label: 'person@example.com',
            email: 'person@example.com',
            account_id: '44444444-4444-4444-8444-444444444444',
            id_token: 'id-token',
            access_token: storedToken,
            refresh_token: 'refresh-token',
            client_id: 'client-id',
            target_paths: {
              opencode: secondOpenCodeAuthPath,
            },
          },
        ],
      }),
    );

    process.env.CQ_CONFIG_HOME = configHome;
    process.env.CODEX_AUTH_PATH = path.join(tempRoot, 'missing-codex-auth.json');
    process.env.OPENCODE_AUTH_PATH = firstOpenCodeAuthPath;

    const accounts = await loadAccounts();
    const account = accounts.find((candidate) => candidate.accountId === '44444444-4444-4444-8444-444444444444');
    expect(account?.targetPaths?.opencode).toBe(secondOpenCodeAuthPath);

    await applyAccountToTargets(account!, ['opencode']);

    const firstWritten = JSON.parse(await fs.readFile(firstOpenCodeAuthPath, 'utf8')) as { openai?: { access?: string } };
    const secondWritten = JSON.parse(await fs.readFile(secondOpenCodeAuthPath, 'utf8')) as { openai?: { access?: string } };

    expect(firstWritten.openai?.access).toBe('old-one');
    expect(secondWritten.openai?.access).toBe(storedToken);
  });
});

describe('upsertManagedAccount', () => {
  it('does not overwrite a different account that happens to share the same email', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cqm-upsert-test-'));
    const configHome = path.join(tempRoot, 'config');
    await fs.mkdir(configHome, { recursive: true });

    process.env.CQ_CONFIG_HOME = configHome;
    process.env.CODEX_AUTH_PATH = path.join(tempRoot, 'missing-codex-auth.json');
    process.env.OPENCODE_AUTH_PATH = path.join(tempRoot, 'missing-opencode-auth.json');

    const makeAccount = (accountId: string, accessToken: string): Account => ({
      key: accountId,
      label: 'person@example.com',
      email: 'person@example.com',
      accountId,
      idToken: `id-${accountId}`,
      accessToken,
      refreshToken: `refresh-${accountId}`,
      clientId: 'client-id',
      expiresAt: new Date('2030-03-17T17:46:40.000Z'),
      source: 'managed',
      filePath: '',
      writable: true,
      sources: ['managed'],
      activeTargets: [],
    });

    const firstToken = makeToken({
      account_id: '11111111-1111-4111-8111-111111111111',
      client_id: 'client-id',
      email: 'person@example.com',
      exp: 1_900_000_000,
    });
    const secondToken = makeToken({
      account_id: '22222222-2222-4222-8222-222222222222',
      client_id: 'client-id',
      email: 'person@example.com',
      exp: 1_900_100_000,
    });

    const firstResult = await upsertManagedAccount(makeAccount('11111111-1111-4111-8111-111111111111', firstToken));
    const secondResult = await upsertManagedAccount(makeAccount('22222222-2222-4222-8222-222222222222', secondToken));

    const accounts = await loadAccounts();

    expect(firstResult).toEqual({ action: 'created', matchedBy: 'none' });
    expect(secondResult).toEqual({ action: 'created', matchedBy: 'none' });
    expect(accounts).toHaveLength(2);
    expect(accounts.map((account) => account.accountId).sort()).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
  });

  it('reports an already matching workspace when account ID is the same', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cqm-upsert-existing-test-'));
    const configHome = path.join(tempRoot, 'config');
    await fs.mkdir(configHome, { recursive: true });

    process.env.CQ_CONFIG_HOME = configHome;
    process.env.CODEX_AUTH_PATH = path.join(tempRoot, 'missing-codex-auth.json');
    process.env.OPENCODE_AUTH_PATH = path.join(tempRoot, 'missing-opencode-auth.json');

    const token = makeToken({
      account_id: '33333333-3333-4333-8333-333333333333',
      client_id: 'client-id',
      email: 'person@example.com',
      exp: 1_900_000_000,
    });

    const account: Account = {
      key: '33333333-3333-4333-8333-333333333333',
      label: 'person@example.com',
      email: 'person@example.com',
      accountId: '33333333-3333-4333-8333-333333333333',
      idToken: 'id-token',
      accessToken: token,
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      expiresAt: new Date('2030-03-17T17:46:40.000Z'),
      source: 'managed',
      filePath: '',
      writable: true,
      sources: ['managed'],
      activeTargets: [],
    };

    await upsertManagedAccount(account);
    const result = await upsertManagedAccount(account);

    expect(result).toEqual({ action: 'updated', matchedBy: 'accountId' });
  });
});

describe('deleteManagedAccount', () => {
  it('removes only the manager-owned copy and leaves discovered external auth intact', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cqm-delete-managed-test-'));
    const configHome = path.join(tempRoot, 'config');
    const codexAuthPath = path.join(tempRoot, 'codex', 'auth.json');

    await fs.mkdir(path.dirname(codexAuthPath), { recursive: true });
    await fs.mkdir(configHome, { recursive: true });

    const accessToken = makeToken({
      account_id: '55555555-5555-4555-8555-555555555555',
      client_id: 'client-id',
      email: 'person@example.com',
      exp: 1_900_100_000,
    });

    await fs.writeFile(
      path.join(configHome, 'accounts.json'),
      JSON.stringify({
        accounts: [
          {
            label: 'person@example.com',
            email: 'person@example.com',
            account_id: '55555555-5555-4555-8555-555555555555',
            id_token: 'managed-id-token',
            access_token: accessToken,
            refresh_token: 'refresh-token',
            client_id: 'client-id',
          },
        ],
      }),
    );

    await fs.writeFile(
      codexAuthPath,
      JSON.stringify({
        tokens: {
          id_token: 'codex-id-token',
          access_token: accessToken,
          refresh_token: 'refresh-token',
          account_id: '55555555-5555-4555-8555-555555555555',
        },
      }),
    );

    process.env.CQ_CONFIG_HOME = configHome;
    process.env.CODEX_AUTH_PATH = codexAuthPath;
    process.env.OPENCODE_AUTH_PATH = path.join(tempRoot, 'missing-opencode-auth.json');

    const [beforeDelete] = await loadAccounts();
    expect(beforeDelete?.sources.sort()).toEqual(['codex', 'managed']);

    await deleteManagedAccount(beforeDelete!);

    const [afterDelete] = await loadAccounts();
    expect(afterDelete?.sources).toEqual(['codex']);

    const savedStore = JSON.parse(await fs.readFile(path.join(configHome, 'accounts.json'), 'utf8')) as {
      accounts: unknown[];
    };
    expect(savedStore.accounts).toEqual([]);
  });
});
