import type { QuotaWindow, UsageData } from './models.js';
import { formatErrorForLog, logError } from './log.js';
import { clampPercent, truncate } from './utils.js';

const DEFAULT_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const QUOTA_TIMEOUT_MS = 30_000;

interface UsageApiResponse {
  plan_type?: string;
  rate_limit?: {
    allowed?: boolean;
    limit_reached?: boolean;
    primary_window?: UsageWindowPayload;
    secondary_window?: UsageWindowPayload;
  };
}

interface UsageWindowPayload {
  limit_window_seconds?: number;
  used_percent?: number;
  reset_at?: number;
}

export class QuotaApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly body: string,
  ) {
    super(message);
  }
}

export class QuotaTransportError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'timeout',
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

export async function fetchUsage(accessToken: string, accountId: string): Promise<UsageData> {
  let response: Response;

  try {
    response = await fetch(process.env.CQ_USAGE_URL?.trim() || DEFAULT_USAGE_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'codex-quota-manager',
        ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
      },
      signal: createTimeoutSignal(QUOTA_TIMEOUT_MS),
    });
  } catch (error) {
    throw mapTransportError(error);
  }

  if (!response.ok) {
    const body = truncate((await response.text()).trim(), 500);
    logError('quota.fetch', 'Quota API returned a non-success status.', { accountId, status: response.status, body });
    throw new QuotaApiError(
      body ? `Quota request failed with status ${response.status}: ${body}` : `Quota request failed with status ${response.status}`,
      response.status,
      body,
    );
  }

  const payload = (await response.json()) as UsageApiResponse;
  const windows: QuotaWindow[] = [];

  if (payload.rate_limit?.primary_window) {
    windows.push(mapWindow(payload.rate_limit.primary_window, 'primary'));
  }
  if (payload.rate_limit?.secondary_window) {
    windows.push(mapWindow(payload.rate_limit.secondary_window, 'secondary'));
  }

  if (windows.length === 0) {
    throw new Error('Quota response did not include any rate-limit windows.');
  }

  return {
    planType: payload.plan_type?.trim() || 'unknown',
    allowed: Boolean(payload.rate_limit?.allowed),
    limitReached: Boolean(payload.rate_limit?.limit_reached),
    windows,
    fetchedAt: new Date(),
  };
}

export function isUnauthorizedQuotaError(error: unknown): boolean {
  return error instanceof QuotaApiError && (error.statusCode === 401 || error.statusCode === 403);
}

function createTimeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs);
  return controller.signal;
}

function mapTransportError(error: unknown): QuotaTransportError {
  if (isTimeoutError(error)) {
    logError('quota.fetch', 'Quota request timed out.', formatErrorForLog(error));
    return new QuotaTransportError(
      'Quota request timed out after 30 seconds. Check your connection and try again.',
      'timeout',
      error,
    );
  }

  const details = extractErrorDetails(error);
  const suffix = details ? ` Details: ${details}` : '';
  logError('quota.fetch', 'Quota request could not reach chatgpt.com.', formatErrorForLog(error));
  return new QuotaTransportError(
    `Quota request could not reach chatgpt.com. Check your connection, proxy, firewall, or TLS settings and try again.${suffix}`,
    'network',
    error,
  );
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function extractErrorDetails(error: unknown): string {
  if (!(error instanceof Error)) {
    return '';
  }

  const message = error.message.trim();
  if (!message || message === 'fetch failed') {
    return '';
  }

  return truncate(message, 120);
}

function mapWindow(window: UsageWindowPayload, fallback: string): QuotaWindow {
  const usedPercent = clampPercent(window.used_percent ?? 0);
  const windowSec = window.limit_window_seconds ?? 0;

  return {
    label: formatWindowLabel(windowSec, fallback),
    usedPercent,
    leftPercent: clampPercent(100 - usedPercent),
    resetAt: window.reset_at ? new Date(window.reset_at * 1000) : undefined,
    windowSec,
  };
}

export function formatWindowLabel(windowSec: number, fallback: string): string {
  if (windowSec === 18_000) {
    return '5 hour usage limit';
  }
  if (windowSec === 604_800) {
    return 'Weekly usage limit';
  }
  if (windowSec > 0 && windowSec % 3600 === 0) {
    return `${windowSec / 3600} hour usage limit`;
  }
  if (windowSec > 0 && windowSec % 60 === 0) {
    return `${windowSec / 60} minute usage limit`;
  }
  if (windowSec > 0) {
    return `${windowSec} second usage limit`;
  }
  return `${fallback} usage limit`;
}
