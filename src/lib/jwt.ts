import type { TokenClaims } from './models.js';
import { asInt, asRecord, asString, canonicalAccountId } from './utils.js';

export function parseAccessToken(token: string): TokenClaims {
  const trimmed = token.trim();
  if (!trimmed) {
    return emptyClaims();
  }

  const parts = trimmed.split('.');
  if (parts.length < 2) {
    return emptyClaims();
  }

  try {
    const payload = Buffer.from(parts[1]!, 'base64url').toString('utf8');
    const json = JSON.parse(payload) as Record<string, unknown>;
    const authClaim = json['https://api.openai.com/auth'];
    const authRecord = asRecord(authClaim);
    const authAccountId = typeof authClaim === 'string'
      ? authClaim.trim()
      : asString(authRecord?.chatgpt_account_id).trim();
    const accountId = canonicalAccountId(
      authAccountId,
      asString(json.account_id).trim(),
      asString(json.sub).trim(),
    );
    const clientId =
      asString(json.client_id).trim() ||
      asString(json.cid).trim() ||
      asString(json.clientId).trim();
    const email = asString(json.email).trim();
    const exp = asInt(json.exp);

    return {
      accountId,
      clientId,
      email,
      expiresAt: exp ? new Date(exp * 1000) : undefined,
    };
  } catch {
    return emptyClaims();
  }
}

function emptyClaims(): TokenClaims {
  return {
    accountId: '',
    clientId: '',
    email: '',
    expiresAt: undefined,
  };
}
