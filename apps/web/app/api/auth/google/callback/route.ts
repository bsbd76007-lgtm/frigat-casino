import { timingSafeEqual } from 'crypto';
import { type NextRequest } from 'next/server';

import {
  GOOGLE_RESULT_KEY,
  GOOGLE_STATE_COOKIE,
  safeReturnPath,
  type GoogleRedirectResult,
} from '@/lib/googleOAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GOOGLE_ERROR_COPY: Record<string, string> = {
  access_denied: 'Google sign-in was cancelled.',
  redirect_uri_mismatch: 'Google sign-in is misconfigured (redirect address not registered).',
};

interface SavedState {
  state: string;
  from: string;
  redirectUri: string;
}

function readSaved(raw: string | undefined): SavedState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SavedState>;
    if (typeof parsed.state !== 'string' || typeof parsed.redirectUri !== 'string') return null;
    return {
      state: parsed.state,
      redirectUri: parsed.redirectUri,
      from: safeReturnPath(parsed.from),
    };
  } catch {
    return null;
  }
}

function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function handoff(result: GoogleRedirectResult, target: string): Response {
  const data = JSON.stringify({ key: GOOGLE_RESULT_KEY, result, target }).replace(/</g, '\\u003c');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Signing in…</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#16171b;color:#9b9ba6;font-family:-apple-system,BlinkMacSystemFont,sans-serif">
<p>Signing in…</p>
<script>
(function () {
  var data = ${data};
  try {
    sessionStorage.setItem(data.key, JSON.stringify(data.result));
  } catch (err) {
    console.error('[google] callback could not store the result', err);
  }
  location.replace(data.target);
})();
</script>
</body>
</html>`;

  const response = new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
  response.headers.append(
    'set-cookie',
    `${GOOGLE_STATE_COOKIE}=; Path=/api/auth/google; Max-Age=0; HttpOnly; SameSite=Lax`
  );
  return response;
}

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const saved = readSaved(request.cookies.get(GOOGLE_STATE_COOKIE)?.value);
  const target = saved?.from ?? '/login';

  const googleError = params.get('error');
  if (googleError) {
    console.warn('[google] callback: Google returned an error', { googleError });
    return handoff(
      { error: GOOGLE_ERROR_COPY[googleError] ?? `Google sign-in failed (${googleError}).` },
      target
    );
  }

  const code = params.get('code');
  const state = params.get('state');

  if (!saved || !state || !sameState(state, saved.state)) {
    console.error('[google] callback: state check failed', {
      hasCookie: Boolean(saved),
      hasState: Boolean(state),
    });
    return handoff({ error: 'Google sign-in expired or was started elsewhere. Please try again.' }, target);
  }

  if (!code) {
    console.error('[google] callback: no authorization code in the response');
    return handoff({ error: 'Google did not return a sign-in code. Please try again.' }, target);
  }

  console.info('[google] callback: code received, handing it to the page', {
    target,
    redirectUri: saved.redirectUri,
  });
  return handoff({ code, redirectUri: saved.redirectUri }, target);
}
