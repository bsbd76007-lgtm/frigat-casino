import { OAuth2Client } from 'google-auth-library';

import { config } from '../config';

export interface GoogleIdentity {
  googleId: string;
  email: string;
}

let client: OAuth2Client | null = null;

export function googleSignInEnabled(): boolean {
  return config.google.clientId.length > 0;
}

export const POPUP_REDIRECT_URI = 'postmessage';

export function googleCodeExchangeEnabled(): boolean {
  return googleSignInEnabled() && config.google.clientSecret.length > 0;
}

export const REDIRECT_CALLBACK_PATH = '/api/auth/google/callback';

export function allowedRedirectUri(uri: string): boolean {
  return config.webOrigins.some((origin) => `${origin}${REDIRECT_CALLBACK_PATH}` === uri);
}

type WarnLogger = { warn: (obj: unknown, msg: string) => void };

export async function exchangeGoogleCode(
  code: string,
  redirectUri: string = POPUP_REDIRECT_URI,
  log?: WarnLogger
): Promise<GoogleIdentity | null> {
  if (!googleCodeExchangeEnabled() || !code) return null;

  const exchanger = new OAuth2Client(config.google.clientId, config.google.clientSecret, redirectUri);

  try {
    const { tokens } = await exchanger.getToken({ code, redirect_uri: redirectUri });
    if (!tokens.id_token) {
      log?.warn({ redirectUri }, 'google code exchange returned no id_token');
      return null;
    }
    const identity = await verifyGoogleIdToken(tokens.id_token);
    if (!identity) log?.warn({ redirectUri }, 'google id_token from code exchange failed verification');
    return identity;
  } catch (err) {
    const data = (err as { response?: { data?: { error?: string; error_description?: string } } })
      .response?.data;
    console.error('[google] getToken failed — raw Google response:', data ?? err, {
      redirectUri,
      clientId: config.google.clientId,
    });
    log?.warn(
      { redirectUri, googleError: data?.error, googleErrorDescription: data?.error_description },
      'google rejected the authorization code exchange'
    );
    return null;
  }
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity | null> {
  if (!googleSignInEnabled() || !idToken) return null;
  client ??= new OAuth2Client(config.google.clientId);

  try {
    const ticket = await client.verifyIdToken({ idToken, audience: config.google.clientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || payload.email_verified !== true) return null;
    return { googleId: payload.sub, email: payload.email.trim().toLowerCase() };
  } catch {
    return null;
  }
}

const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

interface TokenInfo {
  aud?: string;
  azp?: string;
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
  exp?: string;
}

export async function verifyGoogleAccessToken(accessToken: string): Promise<GoogleIdentity | null> {
  if (!googleSignInEnabled() || !accessToken) return null;

  try {
    const response = await fetch(TOKENINFO_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: accessToken }).toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;

    const info = (await response.json()) as TokenInfo;
    const issuedToUs = info.aud === config.google.clientId || info.azp === config.google.clientId;
    const verified = info.email_verified === true || info.email_verified === 'true';
    const live = Number(info.exp) * 1000 > Date.now();
    if (!issuedToUs || !verified || !live || !info.sub || !info.email) return null;

    return { googleId: info.sub, email: info.email.trim().toLowerCase() };
  } catch {
    return null;
  }
}
