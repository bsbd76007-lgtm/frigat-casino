import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { SESSION_COOKIE, verifySession } from '@/lib/adminAuth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const result = await verifySession(token);

  if (result.status === 'valid' || result.status === 'forbidden') {
    return NextResponse.json({
      user: { id: result.claims.userId, role: result.claims.role },
    });
  }

  const response = NextResponse.json({ user: null, reason: result.status });

  if (result.status === 'invalid') response.cookies.delete(SESSION_COOKIE);

  return response;
}

export async function POST(request: Request) {
  const noSession = (reason: string) => NextResponse.json({ user: null, reason });

  let token: unknown;
  try {
    ({ token } = (await request.json()) as { token?: unknown });
  } catch {
    return noSession('invalid_body');
  }

  if (typeof token !== 'string' || token.length === 0) {
    return noSession('token_required');
  }

  const result = await verifySession(token);
  if (result.status === 'misconfigured') {
    return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 });
  }
  if (result.status !== 'valid' && result.status !== 'forbidden') {
    return noSession(result.status);
  }

  const response = NextResponse.json({
    user: { id: result.claims.userId, role: result.claims.role },
    role: result.claims.role,
    userId: result.claims.userId,
  });

  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(result.claims.exp
      ? { expires: new Date(result.claims.exp * 1000) }
      : { maxAge: 60 * 60 }),
  });

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
