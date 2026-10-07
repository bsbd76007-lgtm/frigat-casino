import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/adminAuth';

const PUBLIC_ROUTES = [
  '/login',
  '/register',
  '/api/auth/login',
  '/api/auth/register',
  '/api/session',
];

function isPublic(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

function redirectToLogin(request: NextRequest, reason: string) {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  url.searchParams.set('error', reason);

  if (reason !== 'forbidden' && reason !== 'misconfigured') {
    url.searchParams.set('next', request.nextUrl.pathname);
  }

  const response = NextResponse.redirect(url);
  if (reason === 'invalid') response.cookies.delete(SESSION_COOKIE);
  return response;
}

function isInsecure(request: NextRequest): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (!forwarded) return false;
  if (forwarded.split(',')[0]!.trim().toLowerCase() !== 'http') return false;
  return !isLocalHost(request);
}

function isLocalHost(request: NextRequest): boolean {
  const raw = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
  const host = raw.split(',')[0]!.trim().toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  );
}

export async function middleware(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development' && isInsecure(request)) {
    const secure = request.nextUrl.clone();
    secure.protocol = 'https:';
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    if (host) secure.host = host;
    return NextResponse.redirect(secure, 308);
  }

  if (!request.nextUrl.pathname.startsWith('/admin')) return NextResponse.next();

  if (process.env.NODE_ENV === 'development') return NextResponse.next();

  if (isPublic(request.nextUrl.pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const result = await verifySession(token);

  switch (result.status) {
    case 'valid': {
      const response = NextResponse.next();
      response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      response.headers.set('X-Frame-Options', 'DENY');
      response.headers.set('X-Content-Type-Options', 'nosniff');
      response.headers.set('Referrer-Policy', 'no-referrer');
      return response;
    }
    case 'forbidden':
      return redirectToLogin(request, 'forbidden');
    case 'invalid':
      return redirectToLogin(request, 'invalid');
    case 'misconfigured':
      return redirectToLogin(request, 'misconfigured');
    default:
      return redirectToLogin(request, 'required');
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)'],
};
