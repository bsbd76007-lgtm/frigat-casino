'use client';

import { API_URL, writeStoredToken } from '@/lib/token';
import { readStoredLocale } from '@/components/providers/LanguageProvider';

export const DEFAULT_DESTINATION = '/games/crash';

export const ADMIN_DESTINATION = '/admin/dashboard';

export interface AuthedUser {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  balance?: string;
  frozen?: boolean;
}

interface AuthResponse {
  token?: string;
  user?: AuthedUser;
  error?: string;
  message?: string;
}

export class AuthError extends Error {}

export class TotpRequiredError extends AuthError {
  constructor(readonly challenge: string) {
    super('Enter the code from your authenticator app.');
  }
}

function totpChallengeOf(body: Record<string, unknown>): string | null {
  return body.requiresTotp === true && typeof body.challenge === 'string' ? body.challenge : null;
}

const FALLBACK_COPY: Record<string, string> = {
  invalid_credentials: 'That email and password combination was not recognised.',
  invalid_credentials_format:
    'Enter a valid email address and a password of at least 8 characters.',
  email_taken: 'An account with that email already exists. Sign in instead.',
  too_many_requests: 'Too many attempts. Wait a few minutes and try again.',
  invalid_code: 'That code is not valid or has expired. Request a new one.',
  invalid_code_format: 'Enter the 6-digit code from your email.',
  invalid_totp: 'That code is not valid. Check your authenticator app and try again.',
  challenge_expired: 'That sign-in has expired. Please start again.',
  invalid_email: 'Enter a valid email address.',
  email_unavailable:
    'Email sign-in is temporarily unavailable. Please use your password.',
  otp_cooldown: 'A code was just sent. Wait a moment before asking for another.',
  turnstile_failed: 'Human verification failed. Please try again.',
  weak_password: 'Choose a stronger password.',
  registration_expired: 'That registration has expired. Please start again.',
  invalid_google_token: 'Google sign-in could not be verified. Please try again.',
  google_account_mismatch: 'This email is linked to a different Google account.',
  google_unavailable: 'Google sign-in is not available right now.',
  account_deleted: 'This account has been deleted.',
};

async function establishSession(token: string): Promise<void> {
  writeStoredToken(token);
  try {
    await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch {
  }
}

function messageFor(body: Record<string, unknown>, status: number): string {
  const message = typeof body.message === 'string' ? body.message : undefined;
  const error = typeof body.error === 'string' ? body.error : undefined;

  return message ?? (error && FALLBACK_COPY[error]) ?? `Request failed (${status}).`;
}

export interface OtpSendResult {
  resendAfterSeconds: number;
  expiresInSeconds: number;
  devCode?: string;
}

export async function verifyLoginCode(
  email: string,
  code: string,
  ref?: string | null
): Promise<AuthedUser> {
  const { response, body } = await postJson('/api/auth/otp/verify', { email, code }, ref);

  const totp = response.ok ? totpChallengeOf(body) : null;
  if (totp) throw new TotpRequiredError(totp);

  const parsed = body as AuthResponse;
  if (!response.ok || !parsed.token || !parsed.user) {
    throw new AuthError(messageFor(body, response.status));
  }

  await establishSession(parsed.token);
  return parsed.user;
}

export async function signInWithGoogle(
  code: string,
  redirectUri: string,
  ref?: string | null
): Promise<AuthedUser> {
  console.log('[google] POST /api/auth/google', {
    url: `${API_URL}/api/auth/google`,
    payload: {
      code: `${code.slice(0, 8)}… (${code.length} chars)`,
      redirectUri,
      locale: readStoredLocale(),
    },
    ref: ref ?? null,
  });

  const { response, body } = await postJson('/api/auth/google', { code, redirectUri }, ref);

  const log = response.ok ? console.log : console.error;
  log('[google] /api/auth/google responded', response.status, {
    ...body,
    token: typeof body.token === 'string' ? '(session token received)' : undefined,
    challenge: typeof body.challenge === 'string' ? '(2fa challenge received)' : undefined,
  });

  const totp = response.ok ? totpChallengeOf(body) : null;
  if (totp) throw new TotpRequiredError(totp);

  const parsed = body as AuthResponse;
  if (!response.ok || !parsed.token || !parsed.user) {
    throw new AuthError(messageFor(body, response.status));
  }

  await establishSession(parsed.token);
  return parsed.user;
}

export async function verifyTotp(challenge: string, code: string): Promise<AuthedUser> {
  const { response, body } = await postJson('/api/auth/2fa/verify', { challenge, code });

  const parsed = body as AuthResponse;
  if (!response.ok || !parsed.token || !parsed.user) {
    throw new AuthError(messageFor(body, response.status));
  }

  await establishSession(parsed.token);
  return parsed.user;
}

export interface CodeChallenge {
  email: string;
  resendAfterSeconds: number;
  expiresInSeconds: number;
  devCode?: string;
}

async function postJson(
  path: string,
  payload: Record<string, unknown>,
  ref?: string | null
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, locale: readStoredLocale() }),
    });
  } catch (err) {
    console.error(`[auth] request to ${API_URL}${path} failed before a response (network or CORS)`, err);
    throw new AuthError('Could not reach the FRIGAT server. Is it running?');
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { response, body };
}

function challengeFrom(
  body: Record<string, unknown>,
  fallbackEmail: string
): CodeChallenge {
  return {
    email: typeof body.email === 'string' ? body.email : fallbackEmail,
    resendAfterSeconds:
      typeof body.resendAfterSeconds === 'number' ? body.resendAfterSeconds : 60,
    expiresInSeconds:
      typeof body.expiresInSeconds === 'number' ? body.expiresInSeconds : 300,
    devCode: typeof body.devCode === 'string' ? body.devCode : undefined,
  };
}

export type PasswordResult =
  | { requiresOtp: true; challenge: CodeChallenge }
  | { requiresOtp: false; user: AuthedUser };

export async function submitPassword(
  credentials: { email: string; password: string; turnstileToken?: string },
  ref?: string | null
): Promise<PasswordResult> {
  const { response, body } = await postJson('/api/auth/login', credentials, ref);

  if (!response.ok) throw new AuthError(messageFor(body, response.status));

  const totp = totpChallengeOf(body);
  if (totp) throw new TotpRequiredError(totp);

  const parsed = body as AuthResponse;
  if (parsed.token && parsed.user) {
    await establishSession(parsed.token);
    return { requiresOtp: false, user: parsed.user };
  }

  return { requiresOtp: true, challenge: challengeFrom(body, credentials.email) };
}

export async function requestRegistrationCode(
  credentials: { email: string; password: string; turnstileToken?: string },
  ref?: string | null
): Promise<CodeChallenge> {
  const { response, body } = await postJson(
    '/api/auth/register/request-code',
    credentials,
    ref
  );

  if (!response.ok) throw new AuthError(messageFor(body, response.status));

  return challengeFrom(body, credentials.email);
}

export async function requestPasswordReset(
  email: string,
  turnstileToken?: string
): Promise<CodeChallenge> {
  const { response, body } = await postJson('/api/auth/forgot-password/request', {
    email,
    turnstileToken,
  });

  if (!response.ok) throw new AuthError(messageFor(body, response.status));

  return challengeFrom(body, email);
}

export async function resetPassword(input: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<string> {
  const { response, body } = await postJson('/api/auth/forgot-password/reset', input);

  if (!response.ok) throw new AuthError(messageFor(body, response.status));

  return typeof body.message === 'string'
    ? body.message
    : 'Password reset successfully. You can now sign in.';
}

export async function confirmRegistration(
  email: string,
  code: string,
  ref?: string | null
): Promise<AuthedUser> {
  const { response, body } = await postJson(
    '/api/auth/register/confirm',
    { email, code },
    ref
  );

  const parsed = body as AuthResponse;
  if (!response.ok || !parsed.token || !parsed.user) {
    throw new AuthError(messageFor(body, response.status));
  }

  await establishSession(parsed.token);
  return parsed.user;
}

export function safeDestination(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) {
    return DEFAULT_DESTINATION;
  }
  return next;
}
