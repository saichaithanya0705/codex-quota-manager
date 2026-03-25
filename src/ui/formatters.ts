import type { Account, QuotaWindow } from '../lib/models.js';
import { sourceLabel } from '../lib/models.js';
import { shortAccountId, truncate } from '../lib/utils.js';

export function formatAccountRow(account: Account, width: number): string {
  const targets = account.activeTargets.length > 0 ? `[${account.activeTargets.join(',')}]` : '[stored]';
  const plan = account.usage?.planType ? account.usage.planType.toUpperCase() : 'NO DATA';
  const usage = account.usage
    ? account.usage.windows.map((window) => `${shortWindowLabel(window)}:${Math.round(window.usedPercent)}%`).join(' ')
    : account.lastError
      ? 'ERROR'
      : 'idle';
  const label = truncate(account.label || account.email || shortAccountId(account.accountId), Math.max(16, width - 24));

  return `${label} ${targets} ${plan} ${usage}`.trim();
}

export function formatAccountDetails(account: Account): string {
  const lines = [
    `Label: ${account.label || '-'}`,
    `Email: ${account.email || '-'}`,
    `Account ID: ${account.accountId || '-'}`,
    `Sources: ${account.sources.map(sourceLabel).join(', ') || '-'}`,
    `Active Targets: ${account.activeTargets.join(', ') || '-'}`,
    `Token Expires: ${formatExpiresAt(account.expiresAt)}`,
    `Refresh Token: ${account.refreshToken ? 'available' : 'missing'}`,
    '',
    'Quota',
  ];

  if (account.usage) {
    lines.push(`Plan: ${account.usage.planType}`);
    lines.push(`Allowed: ${account.usage.allowed ? 'yes' : 'no'}`);
    lines.push(`Limit Reached: ${account.usage.limitReached ? 'yes' : 'no'}`);
    lines.push(`Last Fetched: ${account.usage.fetchedAt.toLocaleString()}`);
    lines.push('');
    for (const window of account.usage.windows) {
      lines.push(`- ${window.label}`);
      lines.push(`  Used: ${Math.round(window.usedPercent)}%`);
      lines.push(`  Remaining: ${Math.round(window.leftPercent)}%`);
      lines.push(`  Resets: ${formatReset(window)}`);
    }
  } else {
    lines.push('No usage loaded yet. Press r for the selected account or R for all accounts.');
  }

  if (account.lastError) {
    lines.push('');
    lines.push('Last Error');
    lines.push(account.lastError);
  }

  return lines.join('\n');
}

export function helpText(): string {
  return [
    'Keys',
    '',
    'Up/Down or j/k  Move between accounts',
    'Enter           Open action menu',
    'r               Refresh usage for selected account',
    'R               Refresh usage for all accounts',
    't               Refresh selected account token',
    'a               Apply selected account to Codex',
    'o               Apply selected account to OpenCode',
    'b               Apply selected account to both',
    'n               Add account with browser login',
    'x               Delete managed copy of selected account',
    '?               Toggle help',
    'Esc             Close the current dialog or quit',
    'q / Ctrl+C      Quit',
  ].join('\n');
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
