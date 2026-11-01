import { config } from './config.js';
import { log } from './log.js';

/**
 * Minimal Cloudflare API client for the one thing the app manages itself: the e-mail allowlist of
 * the Access policy in front of the public URL. Needs an API token with
 * "Access: Apps and Policies: Edit" (and "Access: Organizations, Identity Providers, and Groups:
 * Edit" if removed people should also lose their current Access session).
 */
const cf = config.cloudflare;

export const allowlistEnabled = Boolean(cf.apiToken && cf.accountId && cf.appId && cf.policyId);

interface CfResponse<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
}

/** An Access policy rule. Only e-mail rules are managed here; any other rule is passed through untouched. */
type Rule = { email: { email: string } } | Record<string, unknown>;

interface Policy {
  id: string;
  name: string;
  decision: 'allow' | 'deny' | 'non_identity' | 'bypass';
  precedence?: number;
  include: Rule[];
  exclude: Rule[];
  require: Rule[];
}

async function call<T>(method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${cf.apiToken}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as CfResponse<T> | null;
  if (!data || !data.success) {
    const reason = data?.errors?.[0]?.message ?? `HTTP ${res.status}`;
    throw new Error(`Cloudflare API ${method} ${path}: ${reason}`);
  }
  return data.result;
}

const policyPath = `/accounts/${cf.accountId}/access/apps/${cf.appId}/policies/${cf.policyId}`;

const isEmailRule = (r: Rule): r is { email: { email: string } } =>
  typeof (r as { email?: { email?: unknown } }).email?.email === 'string';

const emailsOf = (policy: Policy): string[] => policy.include.filter(isEmailRule).map((r) => r.email.email.toLowerCase());

/** E-mails currently allowed through Cloudflare Access. */
export async function getAllowlist(): Promise<string[]> {
  return emailsOf(await call<Policy>('GET', policyPath));
}

/** Replaces the e-mail rules of the policy with `emails`; non e-mail rules (if any) are kept. */
export async function setAllowlist(emails: string[]): Promise<string[]> {
  const policy = await call<Policy>('GET', policyPath);
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const include: Rule[] = [...policy.include.filter((r) => !isEmailRule(r)), ...unique.map((email) => ({ email: { email } }))];
  const updated = await call<Policy>('PUT', policyPath, {
    name: policy.name,
    decision: policy.decision,
    precedence: policy.precedence,
    include,
    exclude: policy.exclude,
    require: policy.require,
  });
  return emailsOf(updated);
}

/**
 * Ends the person's current Cloudflare Access session so the removal takes effect immediately
 * (otherwise their session cookie stays valid until it expires). Returns false when the token is
 * not allowed to do this; the removal from the allowlist still stands.
 */
export async function revokeAccessSession(email: string): Promise<boolean> {
  try {
    await call('POST', `/accounts/${cf.accountId}/access/organizations/revoke_user`, { email });
    return true;
  } catch (err) {
    log.warn({ email, reason: (err as Error).message }, 'could not revoke the cloudflare access session');
    return false;
  }
}
