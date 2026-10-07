export const GOOGLE_START_PATH = '/api/auth/google/start';
export const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback';
export const GOOGLE_STATE_COOKIE = 'frigat_google_oauth';
export const GOOGLE_RESULT_KEY = 'frigat.google.result';

export interface GoogleRedirectResult {
  code?: string;
  redirectUri?: string;
  error?: string;
}

export function safeReturnPath(value: string | null | undefined, fallback = '/login'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return fallback;
  }
  return value;
}

export function startGoogleSignIn(): void {
  const from = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`${GOOGLE_START_PATH}?from=${encodeURIComponent(from)}`);
}

export function takeGoogleRedirectResult(): GoogleRedirectResult | null {
  try {
    const raw = window.sessionStorage.getItem(GOOGLE_RESULT_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(GOOGLE_RESULT_KEY);
    const parsed = JSON.parse(raw) as GoogleRedirectResult;
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch (err) {
    console.error('[google] could not read the sign-in result', err);
    return null;
  }
}
