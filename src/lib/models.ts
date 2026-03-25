export type Source = 'managed' | 'codex' | 'opencode';
export type Target = Extract<Source, 'codex' | 'opencode'>;

export interface TokenClaims {
  clientId: string;
  accountId: string;
  email: string;
  expiresAt?: Date;
}

export interface QuotaWindow {
  label: string;
  usedPercent: number;
  leftPercent: number;
  resetAt?: Date;
  windowSec: number;
}

export interface UsageData {
  planType: string;
  allowed: boolean;
  limitReached: boolean;
  windows: QuotaWindow[];
  fetchedAt: Date;
}

export interface Account {
  key: string;
  label: string;
  email: string;
  accountId: string;
  idToken: string;
  accessToken: string;
  refreshToken: string;
  clientId: string;
  expiresAt?: Date;
  source: Source;
  filePath: string;
  writable: boolean;
  sources: Source[];
  activeTargets: Target[];
  usage?: UsageData;
  lastError?: string;
}

export function sourceLabel(source: Source): string {
  switch (source) {
    case 'managed':
      return 'app';
    case 'codex':
      return 'codex';
    case 'opencode':
      return 'opencode';
    default:
      return source;
  }
}
