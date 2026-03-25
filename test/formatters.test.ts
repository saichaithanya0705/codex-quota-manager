import { describe, expect, it } from 'vitest';
import type { Account } from '../src/lib/models.js';
import {
  formatAccountRow,
  formatAccountWorkspaceDetails,
  formatAccountWorkspaceSummary,
  getAccountUiState,
  helpText,
} from '../src/ui/formatters.js';

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    key: 'test-account',
    label: 'Primary Account',
    email: 'primary@example.com',
    accountId: 'account-id',
    idToken: 'id-token',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    clientId: 'client-id',
    source: 'managed',
    filePath: 'D:\\accounts\\primary.json',
    writable: true,
    sources: ['managed'],
    activeTargets: ['codex'],
    ...overrides,
  };
}

describe('formatAccountRow', () => {
  it('shows NOT FETCHED when no usage has been loaded', () => {
    const account = createAccount();

    expect(getAccountUiState(account)).toBe('not-fetched');
    expect(formatAccountRow(account, 80)).toContain('NOT FETCHED');
  });

  it('shows ERROR without combining it with NO DATA', () => {
    const account = createAccount({ lastError: 'Quota request could not reach chatgpt.com.' });

    expect(getAccountUiState(account)).toBe('error');
    expect(formatAccountRow(account, 80)).toContain('ERROR');
    expect(formatAccountRow(account, 80)).not.toContain('NO DATA');
  });
});

describe('formatAccountWorkspaceDetails', () => {
  it('shows actionable copy for quota errors', () => {
    const account = createAccount({ lastError: 'Quota request timed out after 30 seconds. Check your connection and try again.' });

    expect(formatAccountWorkspaceDetails(account)).toContain('Unable to load quota. Press r to retry or choose Refresh usage.');
    expect(formatAccountWorkspaceDetails(account)).toContain('Last Error');
  });
});

describe('helpText', () => {
  it('documents h as the primary help shortcut', () => {
    expect(helpText()).toContain('h / ?           Toggle help and shortcuts');
  });

  it('documents Enter as opening the selected account workspace', () => {
    expect(helpText()).toContain('Enter           Open the selected account workspace');
  });
});

describe('formatAccountWorkspaceSummary', () => {
  it('shows whether an account is manager-owned', () => {
    const account = createAccount({ sources: ['managed', 'codex'], activeTargets: ['codex'] });

    expect(formatAccountWorkspaceSummary(account)).toContain('Stored in manager: yes');
    expect(formatAccountWorkspaceSummary(account)).toContain('Active Targets: codex');
  });
});
