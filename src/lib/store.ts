import fs from 'node:fs/promises';
import type { Account, Target } from './models.js';
import { activeIdentityKeys, applyClaimsToAccount, finalizeAccount, identityKeys, mergeAccounts } from './account.js';
import { refreshAccessToken } from './auth.js';
import { readJsonFile, writeJsonAtomic } from './json.js';
import { parseAccessToken } from './jwt.js';
import { getCodexAuthPath, getManagedAccountsPath, getOpenCodeAuthPaths } from './paths.js';
import { asInt, asRecord, asString, canonicalAccountId, dedupeStrings, normalizeEmail } from './utils.js';

interface ManagedStore {
  accounts?: ManagedAccountRecord[];
}

interface ManagedAccountRecord {
  label?: string;
  email?: string;
  account_id: string;
  id_token?: string;
  access_token: string;
  refresh_token?: string;
  client_id?: string;
  expires_at_ms?: number;
}

export async function loadAccounts(): Promise<Account[]> {
  const managedAccounts = await loadManagedAccounts();
  const openCodeAccounts = await loadOpenCodeAccounts();
  const codexAccount = await loadCodexAccount();
  const discovered = [...openCodeAccounts, ...(codexAccount ? [codexAccount] : [])];

  await syncDiscoveredAccounts(discovered);

  const canonicalManaged = await loadManagedAccounts();
  const merged = dedupeAccounts([...canonicalManaged, ...discovered]);
  sortAccounts(merged);
  return merged;
}

export async function upsertManagedAccount(account: Account): Promise<void> {
  const normalized = finalizeAccount(applyClaimsToAccount(stripUsage(account), parseAccessToken(account.accessToken)));
  if (!normalized.accountId.trim()) {
    throw new Error('Cannot save an account without an account ID.');
  }

  const store = await readManagedStore();
  const incoming = accountToManagedRecord(normalized);

  let updated = false;
  store.accounts = (store.accounts ?? []).map((record) => {
    if (recordsMatch(record, incoming)) {
      updated = true;
      return mergeManagedRecords(record, incoming);
    }
    return record;
  });

  if (!updated) {
    store.accounts.push(incoming);
  }

  await saveManagedStore(store);
}

export async function deleteManagedAccount(account: Account): Promise<void> {
  const store = await readManagedStore();
  const targetAccountId = canonicalAccountId(account.accountId);
  const targetEmail = normalizeEmail(account.email);

  store.accounts = (store.accounts ?? []).filter((record) => {
    const recordEmail = normalizeEmail(record.email || '');
    const recordAccountId = canonicalAccountId(record.account_id);
    return !(targetAccountId && recordAccountId === targetAccountId) && !(targetEmail && recordEmail === targetEmail);
  });

  await saveManagedStore(store);
}

export async function persistAccount(account: Account): Promise<void> {
  await upsertManagedAccount(account);
  if (account.activeTargets.length > 0) {
    await applyAccountToTargets(account, account.activeTargets);
  }
}

export async function applyAccountToTargets(account: Account, targets: Target[]): Promise<Map<Target, string>> {
  const result = new Map<Target, string>();
  const uniqueTargets = dedupeStrings(targets);

  for (const target of uniqueTargets) {
    const appliedPath = target === 'codex'
      ? await applyAccountToCodex(account)
      : await applyAccountToOpenCode(account);
    result.set(target, appliedPath);
  }

  return result;
}

async function loadManagedAccounts(): Promise<Account[]> {
  const store = await readManagedStore();
  const accounts: Account[] = [];

  for (const record of store.accounts ?? []) {
    if (!record.access_token?.trim()) {
      continue;
    }

    const account: Account = {
      key: '',
      label: record.label?.trim() || '',
      email: record.email?.trim() || '',
      accountId: record.account_id?.trim() || '',
      idToken: record.id_token?.trim() || '',
      accessToken: record.access_token.trim(),
      refreshToken: record.refresh_token?.trim() || '',
      clientId: record.client_id?.trim() || '',
      expiresAt: record.expires_at_ms ? new Date(record.expires_at_ms) : undefined,
      source: 'managed',
      filePath: getManagedAccountsPath(),
      writable: true,
      sources: ['managed'],
      activeTargets: [],
    };

    accounts.push(finalizeAccount(applyClaimsToAccount(account, parseAccessToken(account.accessToken))));
  }

  sortAccounts(accounts);
  return accounts;
}

async function loadOpenCodeAccounts(): Promise<Account[]> {
  const paths = getOpenCodeAuthPaths();
  const existingPaths: string[] = [];

  for (const candidate of paths) {
    try {
      await fs.access(candidate);
      existingPaths.push(candidate);
    } catch {
      // ignore missing files
    }
  }

  const writablePath = existingPaths[0] ?? paths[0] ?? '';
  const accounts: Account[] = [];

  for (const filePath of existingPaths) {
    const root = await readJsonFile<Record<string, unknown>>(filePath);
    const openAi = asRecord(root?.openai);
    const accessToken = asString(openAi?.access).trim();
    if (!accessToken) {
      continue;
    }

    const expiresMs = asInt(openAi?.expires);
    const account: Account = {
      key: '',
      label: '',
      email: asString(openAi?.email).trim(),
      accountId: asString(openAi?.accountId).trim(),
      idToken: '',
      accessToken,
      refreshToken: asString(openAi?.refresh).trim(),
      clientId: '',
      expiresAt: expiresMs ? new Date(expiresMs) : undefined,
      source: 'opencode',
      filePath,
      writable: filePath === writablePath,
      sources: ['opencode'],
      activeTargets: ['opencode'],
    };

    accounts.push(finalizeAccount(applyClaimsToAccount(account, parseAccessToken(account.accessToken))));
  }

  return accounts;
}

async function loadCodexAccount(): Promise<Account | undefined> {
  const filePath = getCodexAuthPath();
  const root = await readJsonFile<Record<string, unknown>>(filePath);
  const tokens = asRecord(root?.tokens);
  const accessToken = asString(tokens?.access_token).trim();
  if (!accessToken) {
    return undefined;
  }

  const account: Account = {
    key: '',
    label: '',
    email: '',
    accountId: asString(tokens?.account_id).trim(),
    idToken: asString(tokens?.id_token).trim(),
    accessToken,
    refreshToken: asString(tokens?.refresh_token).trim(),
    clientId: '',
    expiresAt: undefined,
    source: 'codex',
    filePath,
    writable: true,
    sources: ['codex'],
    activeTargets: ['codex'],
  };

  return finalizeAccount(applyClaimsToAccount(account, parseAccessToken(account.accessToken)));
}

async function syncDiscoveredAccounts(accounts: Account[]): Promise<void> {
  for (const account of accounts) {
    if (!account.accessToken.trim() || !account.accountId.trim()) {
      continue;
    }
    await upsertManagedAccount(account);
  }
}

function dedupeAccounts(accounts: Account[]): Account[] {
  const mergedAccounts: Account[] = [];
  const index = new Map<string, Account>();
  const activeTargetIndex = buildActiveTargetIndex(accounts);

  for (const account of accounts) {
    const match = findMergedMatch(index, account);
    if (!match) {
      const copy = finalizeAccount(stripUsage(account));
      mergedAccounts.push(copy);
      for (const key of activeIdentityKeys(copy)) {
        index.set(key, copy);
      }
      continue;
    }

    const merged = mergeAccounts(match, account);
    Object.assign(match, merged);
    for (const key of activeIdentityKeys(match)) {
      index.set(key, match);
    }
  }

  for (const account of mergedAccounts) {
    const activeTargets = new Set<Target>();
    for (const key of activeIdentityKeys(account)) {
      const targets = activeTargetIndex.get(key);
      if (!targets) {
        continue;
      }
      for (const target of targets) {
        activeTargets.add(target);
      }
    }
    account.activeTargets = [...activeTargets];
    finalizeAccount(account);
  }

  return mergedAccounts;
}

function buildActiveTargetIndex(accounts: Account[]): Map<string, Set<Target>> {
  const index = new Map<string, Set<Target>>();

  for (const account of accounts) {
    for (const target of account.activeTargets) {
      for (const key of activeIdentityKeys(account)) {
        const bucket = index.get(key) ?? new Set<Target>();
        bucket.add(target);
        index.set(key, bucket);
      }
    }
  }

  return index;
}

function findMergedMatch(index: Map<string, Account>, account: Account): Account | undefined {
  for (const key of activeIdentityKeys(account)) {
    const found = index.get(key);
    if (found) {
      return found;
    }
  }
  for (const key of identityKeys(account)) {
    const found = index.get(key);
    if (found) {
      return found;
    }
  }
  return undefined;
}

async function applyAccountToCodex(account: Account): Promise<string> {
  if (!account.idToken.trim() && account.refreshToken.trim()) {
    await refreshAccessToken(account);
  }

  if (!account.idToken.trim()) {
    throw new Error(
      'Cannot apply this account to Codex because no id_token is available. Re-login through the manager to capture a full Codex session.',
    );
  }

  const filePath = getCodexAuthPath();
  const root = (await readJsonFile<Record<string, unknown>>(filePath)) ?? {};
  const tokens = asRecord(root.tokens) ?? {};

  tokens.id_token = account.idToken;
  tokens.access_token = account.accessToken;
  if (account.refreshToken) {
    tokens.refresh_token = account.refreshToken;
  }
  if (account.accountId) {
    tokens.account_id = account.accountId;
  }

  root.tokens = tokens;
  root.last_refresh = new Date().toISOString();

  await writeJsonAtomic(filePath, root);
  return filePath;
}

async function applyAccountToOpenCode(account: Account): Promise<string> {
  const candidates = getOpenCodeAuthPaths();
  const existingPaths: string[] = [];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      existingPaths.push(candidate);
    } catch {
      // ignore missing files
    }
  }

  const targetPaths = existingPaths.length > 0 ? existingPaths : candidates.slice(0, 1);
  if (targetPaths.length === 0) {
    throw new Error('Could not determine an OpenCode auth path.');
  }

  for (const filePath of targetPaths) {
    const root = (await readJsonFile<Record<string, unknown>>(filePath)) ?? {};
    const openAi = asRecord(root.openai) ?? {};

    openAi.access = account.accessToken;
    if (account.refreshToken) {
      openAi.refresh = account.refreshToken;
    }
    if (account.accountId) {
      openAi.accountId = account.accountId;
    }
    if (account.email) {
      openAi.email = account.email;
    }
    if (account.expiresAt) {
      openAi.expires = account.expiresAt.getTime();
    }

    root.openai = openAi;
    await writeJsonAtomic(filePath, root);
  }

  return targetPaths[0]!;
}

async function readManagedStore(): Promise<Required<ManagedStore>> {
  const store = await readJsonFile<ManagedStore>(getManagedAccountsPath());
  return {
    accounts: store?.accounts ?? [],
  };
}

async function saveManagedStore(store: Required<ManagedStore>): Promise<void> {
  await writeJsonAtomic(getManagedAccountsPath(), store);
}

function accountToManagedRecord(account: Account): ManagedAccountRecord {
  return {
    label: account.label || undefined,
    email: account.email || undefined,
    account_id: account.accountId,
    id_token: account.idToken || undefined,
    access_token: account.accessToken,
    refresh_token: account.refreshToken || undefined,
    client_id: account.clientId || undefined,
    expires_at_ms: account.expiresAt?.getTime(),
  };
}

function mergeManagedRecords(existing: ManagedAccountRecord, incoming: ManagedAccountRecord): ManagedAccountRecord {
  const existingExpiry = existing.expires_at_ms ?? 0;
  const incomingExpiry = incoming.expires_at_ms ?? 0;
  const shouldReplaceToken = !existing.access_token || (incomingExpiry > 0 && incomingExpiry >= existingExpiry);
  const sameAccessToken = existing.access_token === incoming.access_token;

  return {
    label: existing.label || incoming.label,
    email: existing.email || incoming.email,
    account_id: canonicalAccountId(existing.account_id, incoming.account_id),
    id_token: sameAccessToken ? (existing.id_token || incoming.id_token) : (shouldReplaceToken ? incoming.id_token : existing.id_token),
    access_token: shouldReplaceToken ? incoming.access_token : existing.access_token,
    refresh_token: shouldReplaceToken ? (incoming.refresh_token || existing.refresh_token) : (existing.refresh_token || incoming.refresh_token),
    client_id: shouldReplaceToken ? (incoming.client_id || existing.client_id) : (existing.client_id || incoming.client_id),
    expires_at_ms: shouldReplaceToken ? (incoming.expires_at_ms || existing.expires_at_ms) : (existing.expires_at_ms || incoming.expires_at_ms),
  };
}

function recordsMatch(left: ManagedAccountRecord, right: ManagedAccountRecord): boolean {
  const leftId = canonicalAccountId(left.account_id);
  const rightId = canonicalAccountId(right.account_id);
  if (leftId && rightId && leftId === rightId) {
    return true;
  }

  return normalizeEmail(left.email || '') !== '' && normalizeEmail(left.email || '') === normalizeEmail(right.email || '');
}

function stripUsage(account: Account): Account {
  return {
    ...account,
    usage: undefined,
    lastError: undefined,
    sources: [...account.sources],
    activeTargets: [...account.activeTargets],
  };
}

function sortAccounts(accounts: Account[]): void {
  accounts.sort((left, right) => {
    const leftLabel = `${left.label || left.email || left.accountId}`.toLowerCase();
    const rightLabel = `${right.label || right.email || right.accountId}`.toLowerCase();
    return leftLabel.localeCompare(rightLabel);
  });
}
