import type { Account, QuotaWindow } from '../lib/models.js';
import { sourceLabel } from '../lib/models.js';
import { shortAccountId, truncate } from '../lib/utils.js';

export type AccountUiState = 'loaded' | 'error' | 'not-fetched';

export function formatAccountRow(account: Account, width: number): string {
  const label = truncate(formatAccountLabel(account), Math.max(18, width - 34));
  const badges = formatRowBadges(account);
  const quota = formatRowQuota(account);

  return [label, badges, quota].filter(Boolean).join(' ').trim();
}

export function formatAccountWorkspaceSummary(account: Account): string {
  const lines = [
    `Account: ${account.label || formatAccountLabel(account) || '-'}`,
    `Email: ${account.email || '-'}`,
    `Workspace ID: ${account.accountId || '-'}`,
    `Sources: ${account.sources.map(sourceLabel).join(', ') || '-'}`,
    `Active Targets: ${account.activeTargets.join(', ') || '-'}`,
    `Stored in manager: ${account.sources.includes('managed') ? 'yes' : 'no'}`,
    `Token Expires: ${formatExpiresAt(account.expiresAt)}`,
    `Refresh Token: ${account.refreshToken ? 'available' : 'missing'}`,
  ];

  if (account.targetPaths?.codex) {
    lines.push(`Codex Path: ${account.targetPaths.codex}`);
  }
  if (account.targetPaths?.opencode) {
    lines.push(`OpenCode Path: ${account.targetPaths.opencode}`);
  }

  return lines.join('\n');
}

export function formatAccountWorkspaceDetails(account: Account): string {
  const lines = ['Quota'];

  if (account.usage) {
    lines.push(`Plan: ${account.usage.planType.toUpperCase()}`);
    lines.push(`Allowed: ${account.usage.allowed ? 'yes' : 'no'}`);
    lines.push(`Limit Reached: ${account.usage.limitReached ? 'yes' : 'no'}`);
    lines.push(`Last Fetched: ${account.usage.fetchedAt.toLocaleString()}`);
    lines.push('');
    for (const window of account.usage.windows) {
      lines.push(`${window.label}`);
      lines.push(`  Used: ${Math.round(window.usedPercent)}%`);
      lines.push(`  Remaining: ${Math.round(window.leftPercent)}%`);
      lines.push(`  Resets: ${formatReset(window)}`);
      lines.push('');
    }
  } else if (account.lastError) {
    lines.push('Unable to load quota. Press r to retry or choose Refresh usage.');
  } else {
    lines.push('No usage loaded yet. Press r to fetch quota or choose Refresh usage.');
  }

  if (account.lastError) {
    if (lines[lines.length - 1] !== '') {
      lines.push('');
    }
    lines.push('Last Error');
    lines.push(account.lastError);
  }

  return lines.join('\n').trim();
}

export function helpText(): string {
  return [
    'Help & Shortcuts',
    '',
    'Main screen',
    'Up/Down or j/k  Move between accounts',
    'Enter           Open the selected account workspace',
    'n               Add account with browser login',
    'r               Refresh usage for selected account',
    'R               Refresh usage for all accounts',
    't               Refresh selected account token',
    'a               Apply selected account to Codex',
    'o               Apply selected account to OpenCode',
    'b               Apply selected account to both',
    'x               Delete the managed copy when available',
    '',
    'Support',
    'h / ?           Toggle help and shortcuts',
    'l               View application logs',
    'Esc             Close the current dialog or quit',
    'q / Ctrl+C      Quit',
  ].join('\n');
}

export function getAccountUiState(account: Account): AccountUiState {
  if (account.usage) {
    return 'loaded';
  }

  if (account.lastError) {
    return 'error';
  }

  return 'not-fetched';
}

function formatRowBadges(account: Account): string {
  const badges = account.sources.map(sourceLabel);
  return badges.length > 0 ? `[${badges.join(',')}]` : '';
}

function formatRowQuota(account: Account): string {
  const state = getAccountUiState(account);
  if (state === 'loaded' && account.usage) {
    const windows = account.usage.windows.map((window) => `${shortWindowLabel(window)}:${Math.round(window.usedPercent)}%`).join(' ');
    return `${account.usage.planType.toUpperCase()} ${windows}`.trim();
  }

  return state === 'error' ? 'ERROR' : 'NOT FETCHED';
}

function formatExpiresAt(expiresAt?: Date): string {
  if (!expiresAt) {
    return '-';
  }

  return `${expiresAt.toLocaleString()} (${formatRelative(expiresAt)})`;
}

function formatReset(window: QuotaWindow): string {
  if (!window.resetAt) {
    return '-';
  }

  return `${window.resetAt.toLocaleString()} (${formatRelative(window.resetAt)})`;
}

function formatRelative(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const totalMinutes = Math.round(absMs / 60_000);
  const totalHours = Math.round(absMs / 3_600_000);
  const totalDays = Math.round(absMs / 86_400_000);

  let phrase = '';
  if (absMs < 60_000) {
    phrase = 'under a minute';
  } else if (totalMinutes < 60) {
    phrase = `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`;
  } else if (totalHours < 48) {
    phrase = `${totalHours} hour${totalHours === 1 ? '' : 's'}`;
  } else {
    phrase = `${totalDays} day${totalDays === 1 ? '' : 's'}`;
  }

  return diffMs >= 0 ? `in ${phrase}` : `${phrase} ago`;
}

function shortWindowLabel(window: QuotaWindow): string {
  if (window.windowSec === 18_000) {
    return '5h';
  }
  if (window.windowSec === 604_800) {
    return '1w';
  }
  if (window.windowSec > 0 && window.windowSec % 3600 === 0) {
    return `${window.windowSec / 3600}h`;
  }
  return 'lim';
}

function formatAccountLabel(account: Account): string {
  const email = account.email.trim();
  const shortId = shortAccountId(account.accountId);

  if (email && shortId) {
    return `${email} (${shortId})`;
  }

  return account.label || email || shortId;
}
