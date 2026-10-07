import { randomBytes } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';

import {
  GOOGLE_CALLBACK_PATH,
  GOOGLE_STATE_COOKIE,
  safeReturnPath,
} from '@/lib/googleOAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export function GET(request: NextRequest) {
  const from = safeReturnPath(request.nextUrl.searchParams.get('from'));
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';

  if (!clientId) {
    console.error('[google] start: NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set');
    const back = new URL(from, request.nextUrl.origin);
    back.searchParams.set('google_error', 'unavailable');
    return NextResponse.redirect(back);
  }

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ?? `${request.nextUrl.origin}${GOOGLE_CALLBACK_PATH}`;
  const state = randomBytes(24).toString('base64url');

  const authorize = new URL(GOOGLE_AUTH_URL);
  authorize.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
    hl: 'en',
  }).toString();

  console.info('[google] start: redirecting to Google', { redirectUri, from });

  const response = NextResponse.redirect(authorize);
  response.cookies.set(GOOGLE_STATE_COOKIE, JSON.stringify({ state, from, redirectUri }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth/google',
    maxAge: 600,
  });
  return response;
}
