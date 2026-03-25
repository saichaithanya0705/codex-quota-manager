import type { Account, Source, Target, TokenClaims } from './models.js';
import { sourceLabel } from './models.js';
import { canonicalAccountId, dedupeStrings, hashToken, normalizeEmail, shortAccountId } from './utils.js';

const sourceRank: Record<Source, number> = {
  managed: 3,
  codex: 2,
  opencode: 1,
};

export function cloneAccount(account: Account): Account {
  return {
    ...account,
    expiresAt: account.expiresAt ? new Date(account.expiresAt) : undefined,
    sources: [...account.sources],
    activeTargets: [...account.activeTargets],
    usage: account.usage
      ? {
          ...account.usage,
          fetchedAt: new Date(account.usage.fetchedAt),
          windows: account.usage.windows.map((window) => ({
            ...window,
            resetAt: window.resetAt ? new Date(window.resetAt) : undefined,
          })),
        }
      : undefined,
  };
}

export function applyClaimsToAccount(account: Account, claims: TokenClaims): Account {
  account.accountId = canonicalAccountId(account.accountId, claims.accountId);
  if (!account.clientId && claims.clientId) {
    account.clientId = claims.clientId;
  }
  if (!account.email && claims.email) {
    account.email = claims.email;
  }
  if (!account.expiresAt && claims.expiresAt) {
    account.expiresAt = claims.expiresAt;
  }

  return finalizeAccount(account);
}

export function identityKeys(account: Pick<Account, 'accountId' | 'email'>): string[] {
  const keys: string[] = [];

  if (account.accountId.trim()) {
    keys.push(`account:${account.accountId.trim()}`);
  }

  const email = normalizeEmail(account.email);
  if (email) {
    keys.push(`email:${email}`);
  }

  return keys;
}

export function activeIdentityKeys(
  account: Pick<Account, 'accountId' | 'email' | 'accessToken' | 'refreshToken'>,
): string[] {
  const keys = [...identityKeys(account as Pick<Account, 'accountId' | 'email'>)];
  const accessKey = hashToken('access', account.accessToken);
  if (accessKey) {
    keys.push(accessKey);
  }

  const refreshKey = hashToken('refresh', account.refreshToken);
  if (refreshKey) {
    keys.push(refreshKey);
  }

  return keys;
}

export function finalizeAccount(account: Account): Account {
  if (shouldUseEmailAsLabel(account)) {
    account.label = account.email.trim();
  }

  if (!account.label.trim()) {
    if (account.email.trim()) {
      account.label = account.email.trim();
    } else if (account.accountId.trim()) {
      account.label = shortAccountId(account.accountId);
    } else {
      account.label = sourceLabel(account.source);
    }
  }

  if (!account.key.trim()) {
    account.key = account.accountId.trim()
      ? account.accountId.trim()
      : `${account.source}:${account.filePath || account.label}`;
  }

  account.sources = dedupeStrings(account.sources.length ? account.sources : [account.source]);
  account.activeTargets = dedupeStrings(account.activeTargets);

  return account;
}

export function mergeAccounts(current: Account, incoming: Account): Account {
  const merged = cloneAccount(current);
  const sameAccessToken = merged.accessToken === incoming.accessToken;

  merged.sources = dedupeStrings([...merged.sources, ...incoming.sources, incoming.source]);
  merged.activeTargets = dedupeStrings([...merged.activeTargets, ...incoming.activeTargets]);
  merged.accountId = canonicalAccountId(merged.accountId, incoming.accountId);

  if (!merged.email && incoming.email) {
    merged.email = incoming.email;
  }
  if (!merged.refreshToken && incoming.refreshToken) {
    merged.refreshToken = incoming.refreshToken;
  }
  if (!merged.idToken && incoming.idToken) {
    merged.idToken = incoming.idToken;
  }
  if (!merged.clientId && incoming.clientId) {
    merged.clientId = incoming.clientId;
  }
  if (!merged.filePath && incoming.filePath) {
    merged.filePath = incoming.filePath;
  }

  if (preferIncomingToken(merged, incoming)) {
    merged.accessToken = incoming.accessToken;
    merged.refreshToken = incoming.refreshToken || merged.refreshToken;
    merged.idToken = sameAccessToken ? (merged.idToken || incoming.idToken) : incoming.idToken;
    merged.clientId = incoming.clientId || merged.clientId;
    merged.expiresAt = incoming.expiresAt ?? merged.expiresAt;
  } else if (sameAccessToken && !merged.idToken && incoming.idToken) {
    merged.idToken = incoming.idToken;
  }

  if (
    sourceRank[incoming.source] > sourceRank[merged.source] ||
    (incoming.source === 'managed' && merged.source !== 'managed')
  ) {
    merged.source = incoming.source;
    merged.filePath = incoming.filePath || merged.filePath;
    merged.writable = incoming.writable || merged.writable;
  } else {
    merged.writable = merged.writable || incoming.writable;
  }

  if (!merged.label && incoming.label) {
    merged.label = incoming.label;
  }
  if (shouldUseEmailAsLabel(merged) && incoming.email) {
    merged.label = incoming.email;
  }

  return finalizeAccount(merged);
}

export function attachActiveTargets(account: Account, activeTargets: Target[]): Account {
  account.activeTargets = dedupeStrings([...account.activeTargets, ...activeTargets]);
  return finalizeAccount(account);
}

function preferIncomingToken(current: Account, incoming: Account): boolean {
  if (!incoming.accessToken.trim()) {
    return false;
  }

  if (!current.accessToken.trim()) {
    return true;
  }

  if (incoming.expiresAt && !current.expiresAt) {
    return true;
  }

  if (incoming.expiresAt && current.expiresAt && incoming.expiresAt > current.expiresAt) {
    return true;
  }

  return false;
}

function shouldUseEmailAsLabel(account: Account): boolean {
  const email = account.email.trim();
  if (!email) {
    return false;
  }

  const label = account.label.trim();
  if (!label) {
    return true;
  }

  if (label === sourceLabel(account.source)) {
    return true;
  }

  if (label.toLowerCase() === 'n/a') {
    return true;
  }

  if (account.accountId && label === shortAccountId(account.accountId)) {
    return true;
  }

  return label.toLowerCase().startsWith('auth0|');
}
