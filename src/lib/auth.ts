import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { URLSearchParams } from 'node:url';
import type { Account } from './models.js';
import { applyClaimsToAccount, finalizeAccount } from './account.js';
import { parseAccessToken } from './jwt.js';
import { formatErrorForLog, logError, logInfo, logWarn } from './log.js';
import { asString, truncate } from './utils.js';

const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const CALLBACK_PORT = 1455;
const OAUTH_SCOPE = 'openid profile email offline_access';

interface TokenExchangeResponse {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

interface MeResponse {
  email?: string;
  name?: string;
}

export interface LoginStatus {
  authUrl: string;
  browserOpenFailed: boolean;
}

export async function refreshAccessToken(account: Account): Promise<Account> {
  if (!account.refreshToken.trim()) {
    throw new Error('Refresh token is missing.');
  }

  const claims = parseAccessToken(account.accessToken);
  const clientId = account.clientId || claims.clientId;
  if (!clientId.trim()) {
    throw new Error('Cannot refresh token without a client ID. Re-login is required.');
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: account.refreshToken,
      client_id: clientId,
    }),
  });

  if (!response.ok) {
    logError('auth.refresh', 'Token refresh failed.', { accountId: account.accountId, status: response.status });
    throw new Error(`Token refresh failed with status ${response.status}: ${truncate((await response.text()).trim(), 500)}`);
  }

  const payload = (await response.json()) as TokenExchangeResponse;
  if (!payload.access_token?.trim()) {
    throw new Error('Refresh response did not include a new access token.');
  }

  if (payload.id_token?.trim()) {
    account.idToken = payload.id_token.trim();
  }
  account.accessToken = payload.access_token.trim();
  if (payload.refresh_token?.trim()) {
    account.refreshToken = payload.refresh_token.trim();
  }
  if (payload.expires_in && payload.expires_in > 0) {
    account.expiresAt = new Date(Date.now() + payload.expires_in * 1000);
  }

  const refreshed = applyClaimsToAccount(account, parseAccessToken(account.accessToken));
  logInfo('auth.refresh', 'Token refresh completed.', { accountId: refreshed.accountId, expiresAt: refreshed.expiresAt?.toISOString() });
  return refreshed;
}

export function isExpired(account: Account): boolean {
  if (!account.expiresAt) {
    const claims = parseAccessToken(account.accessToken);
    if (claims.expiresAt) {
      account.expiresAt = claims.expiresAt;
    }
  }

  if (!account.expiresAt) {
    return false;
  }

  return Date.now() >= account.expiresAt.getTime() - 5 * 60 * 1000;
}

export async function loginWithBrowser(
  onStatus?: (status: LoginStatus) => void,
  timeoutMs = 5 * 60 * 1000,
): Promise<Account> {
  logInfo('auth.login', 'Starting browser login flow.', { redirectUri: REDIRECT_URI, callbackPort: CALLBACK_PORT });
  const verifier = randomBase64Url(32);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('hex');
  const authUrl = buildAuthorizeUrl(state, challenge);

  let browserOpenFailed = false;
  const server = http.createServer();

  const account = await new Promise<Account>((resolve, reject) => {
    let finished = false;
    const finish = (error?: Error, value?: Account) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeoutHandle);
      server.close(() => undefined);

      if (error) {
        reject(error);
      } else if (value) {
        resolve(value);
      } else {
        reject(new Error('OAuth login did not produce an account.'));
      }
    };

    const timeoutHandle = setTimeout(() => {
      const error = new Error(`Authentication timed out. Open ${authUrl} to retry.`);
      logError('auth.login', 'Browser login timed out.', { authUrl });
      finish(error);
    }, timeoutMs);

    server.on('request', async (request: http.IncomingMessage, response: http.ServerResponse) => {
      try {
        const requestUrl = new URL(request.url || '/', REDIRECT_URI);
        if (requestUrl.pathname !== '/auth/callback') {
          response.statusCode = 404;
          response.end('Not found');
          return;
        }

        if (requestUrl.searchParams.get('state') !== state) {
          response.statusCode = 400;
          response.end('State mismatch');
          logError('auth.login', 'OAuth state mismatch.', { receivedState: requestUrl.searchParams.get('state') });
          finish(new Error('OAuth state mismatch.'));
          return;
        }

        const oauthError = requestUrl.searchParams.get('error');
        if (oauthError) {
          const description = requestUrl.searchParams.get('error_description') || 'OAuth provider returned an error.';
          const message = `OAuth login failed: ${oauthError}${description ? ` - ${description}` : ''}`;
          response.statusCode = 400;
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end(`<h1>Authentication failed</h1><p>${escapeHtml(message)}</p>`);
          logError('auth.login', 'OAuth provider returned an error callback.', {
            error: oauthError,
            description,
          });
          finish(new Error(message));
          return;
        }

        const code = requestUrl.searchParams.get('code');
        if (!code) {
          response.statusCode = 400;
          response.end('Missing code');
          logError('auth.login', 'OAuth callback missing authorization code.');
          finish(new Error('OAuth callback did not include an authorization code.'));
          return;
        }

        const tokenResponse = await exchangeCodeForToken(code, verifier);
        const builtAccount = await accountFromTokenResponse(tokenResponse);
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end('Authentication successful. You can close this window.');
        logInfo('auth.login', 'Browser login completed.', { accountId: builtAccount.accountId, email: builtAccount.email || undefined });
        finish(undefined, builtAccount);
      } catch (error) {
        response.statusCode = 500;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(`<h1>Authentication failed</h1><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`);
        logError('auth.login', 'OAuth callback handling failed.', formatErrorForLog(error));
        finish(error as Error);
      }
    });

    server.listen(CALLBACK_PORT, async () => {
      try {
        await openExternal(authUrl);
      } catch {
        browserOpenFailed = true;
        logWarn('auth.login', 'Browser did not open automatically.', { authUrl });
      }

      onStatus?.({
        authUrl,
        browserOpenFailed,
      });
    });

    server.on('error', (error: Error) => {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        const wrapped = new Error(`Login callback port ${CALLBACK_PORT} is already in use. Close other Codex Quota Manager login windows and try again.`);
        logError('auth.login', 'Callback port already in use.', formatErrorForLog(error));
        finish(wrapped);
        return;
      }

      logError('auth.login', 'OAuth callback server failed.', formatErrorForLog(error));
      finish(error as Error);
    });
  });

  return finalizeAccount(account);
}

async function accountFromTokenResponse(payload: TokenExchangeResponse): Promise<Account> {
  const accessToken = payload.access_token?.trim() || '';
  const refreshToken = payload.refresh_token?.trim() || '';
  if (!accessToken || !refreshToken) {
    logError('auth.login', 'Token exchange response did not include required tokens.', {
      hasAccessToken: Boolean(accessToken),
      hasRefreshToken: Boolean(refreshToken),
      hasIdToken: Boolean(payload.id_token?.trim()),
    });
    throw new Error('Token exchange response was missing required tokens.');
  }

  const claims = parseAccessToken(accessToken);
  const account: Account = {
    key: '',
    label: '',
    email: claims.email,
    accountId: claims.accountId,
    idToken: payload.id_token?.trim() || '',
    accessToken,
    refreshToken,
    clientId: claims.clientId || OAUTH_CLIENT_ID,
    expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : claims.expiresAt,
    source: 'managed',
    filePath: '',
    writable: true,
    sources: ['managed'],
    activeTargets: [],
  };

  if (!account.email) {
    try {
      const me = await fetchCurrentUser(accessToken);
      account.email = me.email;
      if (!account.label && me.name) {
        account.label = me.name;
      }
    } catch (error) {
      logWarn('auth.login', 'Profile lookup failed during browser login; continuing with token claims only.', formatErrorForLog(error));
    }
  }

  if (!account.label && account.email) {
    account.label = account.email;
  }

  if (!account.accountId) {
    logError('auth.login', 'Access token did not include account ID.');
    throw new Error('Failed to determine account ID from the access token.');
  }

  return finalizeAccount(account);
}

async function exchangeCodeForToken(code: string, verifier: string): Promise<TokenExchangeResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: OAUTH_CLIENT_ID,
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    logError('auth.login', 'Token exchange failed.', { status: response.status });
    throw new Error(`Token exchange failed with status ${response.status}: ${truncate((await response.text()).trim(), 500)}`);
  }

  logInfo('auth.login', 'Token exchange completed.');
  return (await response.json()) as TokenExchangeResponse;
}

async function fetchCurrentUser(accessToken: string): Promise<{ email: string; name: string }> {
  const response = await fetch('https://api.openai.com/v1/me', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    logError('auth.login', 'Fetching current user profile failed.', { status: response.status });
    throw new Error(`Failed to fetch user profile: ${response.status} ${truncate((await response.text()).trim(), 300)}`);
  }

  const payload = (await response.json()) as MeResponse;
  return {
    email: asString(payload.email).trim(),
    name: asString(payload.name).trim(),
  };
}

function buildAuthorizeUrl(state: string, challenge: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: OAUTH_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'codex-quota-manager',
  });

  return `${AUTHORIZE_URL}?${params.toString()}`;
}

function randomBase64Url(size: number): string {
  return randomBytes(size).toString('base64url');
}

async function openExternal(url: string): Promise<void> {
  const child = (() => {
    switch (process.platform) {
      case 'win32':
        return spawn('rundll32', ['url.dll,FileProtocolHandler', url], {
          detached: true,
          stdio: 'ignore',
        });
      case 'darwin':
        return spawn('open', [url], {
          detached: true,
          stdio: 'ignore',
        });
      default:
        return spawn('xdg-open', [url], {
          detached: true,
          stdio: 'ignore',
        });
    }
  })();

  child.unref();

  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', () => resolve());
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
