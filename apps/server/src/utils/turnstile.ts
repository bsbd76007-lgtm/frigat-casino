import { config } from '../config';

const VERIFY_TIMEOUT_MS = 5000;

export type TurnstileOutcome =
  | { ok: true; bypassed: boolean }
  | { ok: false; codes: string[]; misconfigured: boolean };

const CONFIG_ERROR_CODES = new Set([
  'invalid-input-secret',
  'missing-input-secret',
  'bad-request',
]);

function rejection(codes: string[]): TurnstileOutcome {
  return {
    ok: false,
    codes,
    misconfigured: codes.some((code) => CONFIG_ERROR_CODES.has(code)),
  };
}

interface SiteVerifyResponse {
  success?: boolean;
  'error-codes'?: string[];
}

let warnedAboutMissingSecret = false;

function warnOnceAboutMissingSecret(): void {
  if (warnedAboutMissingSecret) return;
  warnedAboutMissingSecret = true;

   
  console.error(
    '[turnstile] TURNSTILE_SECRET_KEY is not set. Human verification cannot run, so every sign-in and sign-up is being REFUSED with 503. ' +
      'Set the secret, or set TURNSTILE_DISABLED=true to accept traffic unchecked while you finish configuring the deployment.'
  );
}

let warnedAboutDisabled = false;

function warnOnceAboutDisabled(): void {
  if (warnedAboutDisabled) return;
  warnedAboutDisabled = true;

   
  console.warn(
    '[turnstile] TURNSTILE_DISABLED is set — human verification is OFF and every request is accepted unchecked. ' +
      'This is for first-deploy testing only. Unset it before taking real money.'
  );
}

function bypassReason(
  token: string,
  secret: string
): 'disabled' | 'no-secret' | 'no-token' | null {
  if (config.turnstile.disabled) return 'disabled';
  if (config.env !== 'development') return null;
  if (!secret) return 'no-secret';
  if (!token) return 'no-token';
  return null;
}

export async function verifyTurnstileToken(
  token?: string,
  remoteIp?: string
): Promise<TurnstileOutcome> {
  const secret = config.turnstile.secretKey;

  const trimmed = typeof token === 'string' ? token.trim() : '';

  const bypass = bypassReason(trimmed, secret);
  if (bypass === 'disabled') {
    warnOnceAboutDisabled();
    return { ok: true, bypassed: true };
  }
  if (bypass === 'no-secret') {
    warnOnceAboutMissingSecret();
    return { ok: true, bypassed: true };
  }
  if (bypass === 'no-token') {
     
    console.log('[DEV] No Turnstile token supplied — skipping verification on localhost');
    return { ok: true, bypassed: true };
  }

  if (!secret) {
    warnOnceAboutMissingSecret();
    return rejection(['missing-input-secret']);
  }
  if (!trimmed) return rejection(['missing-input-response']);

  const body = new URLSearchParams({ secret, response: trimmed });
  if (remoteIp && remoteIp.length <= 45) body.set('remoteip', remoteIp);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

  try {
    const response = await fetch(config.turnstile.verifyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });

    const result = (await response
      .json()
      .catch(() => ({}) as SiteVerifyResponse)) as SiteVerifyResponse;

    if (result.success === true) return { ok: true, bypassed: false };

    const codes = result['error-codes'] ?? [];
    if (codes.length > 0) return rejection(codes);

    return rejection([`http-${response.status}`]);
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return rejection([aborted ? 'timeout' : 'network-error']);
  } finally {
    clearTimeout(timer);
  }
}

export function isTurnstileEnforced(): boolean {
  return Boolean(config.turnstile.secretKey);
}
