import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { SESSION_COOKIE, verifySession } from '@/lib/adminAuth';
import { API_URL } from '@/lib/endpoints';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_BASE = API_URL;

const ALLOWED = [
  /^users$/,
  /^users\/[A-Za-z0-9_-]+$/,
  /^users\/[A-Za-z0-9_-]+\/balance$/,
  /^users\/[A-Za-z0-9_-]+\/role$/,
  /^users\/[A-Za-z0-9_-]+\/freeze$/,
  /^users\/[A-Za-z0-9_-]+\/revshare$/,
  /^transactions$/,
  /^metrics$/,
  /^withdrawals$/,
  /^withdrawals\/[A-Za-z0-9_-]+$/,
  /^risk$/,
  /^audit-logs$/,
];

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

async function forward(request: Request, path: string[], method: string) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? bearer(request);

  const session = await verifySession(token);
  if (session.status !== 'valid') {
    return NextResponse.json(
      { error: 'unauthorized', detail: `No valid admin session (${session.status}).` },
      { status: 401 }
    );
  }

  const suffix = path.join('/');
  if (!ALLOWED.some((pattern) => pattern.test(suffix))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const search = new URL(request.url).search;
  const body =
    method === 'GET' || method === 'DELETE' ? undefined : await request.text();

  try {
    const upstream = await fetch(`${API_BASE}/api/admin/${suffix}${search}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body,
      cache: 'no-store',
    });

    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'upstream_unreachable', detail: `Could not reach ${API_BASE}` },
      { status: 502 }
    );
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await ctx.params).path, 'GET');
}
export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await ctx.params).path, 'POST');
}
export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await ctx.params).path, 'PUT');
}
export async function PATCH(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await ctx.params).path, 'PATCH');
}
