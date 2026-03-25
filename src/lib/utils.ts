import { createHash } from 'node:crypto';
import type { Account } from './models.js';

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

export function asString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}

export function asInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 100) {
    return 100;
  }

  return value;
}

export function shortAccountId(accountId: string): string {
  const trimmed = accountId.trim();
  if (trimmed.length <= 12) {
    return trimmed;
  }

  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

export function canonicalAccountId(...ids: string[]): string {
  const cleaned = ids
    .map((value) => value.trim())
    .filter(Boolean);

  if (cleaned.length === 0) {
    return '';
  }

  const uuid = cleaned.find(isUuidLike);
  return uuid ?? cleaned[0]!;
}

export function dedupeStrings<T extends string>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}

export function hashToken(prefix: string, token: string): string {
  const trimmed = token.trim();
  if (!trimmed) {
    return '';
  }

  return `${prefix}:${createHash('sha256').update(trimmed).digest('hex').slice(0, 16)}`;
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function sameAccountIdentity(left: Account, right: Account): boolean {
  if (left.accountId && right.accountId && left.accountId === right.accountId) {
    return true;
  }

  if (left.email && right.email && normalizeEmail(left.email) === normalizeEmail(right.email)) {
    return true;
  }

  return false;
}
