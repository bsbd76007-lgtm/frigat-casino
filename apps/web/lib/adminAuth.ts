import { jwtVerify } from 'jose';

export const SESSION_COOKIE = 'token';

export interface AdminClaims {
  userId: string;
  role: 'USER' | 'ADMIN';
  exp?: number;
}

export type SessionResult =
  | { status: 'valid'; claims: AdminClaims }
  | { status: 'anonymous' }
  | { status: 'invalid' }
  | { status: 'forbidden'; claims: AdminClaims }
  | { status: 'misconfigured' };

function secretKey(): Uint8Array | null {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) return null;
  return new TextEncoder().encode(secret);
}

export async function verifySession(
  token: string | undefined | null
): Promise<SessionResult> {
  const key = secretKey();
  if (!key) return { status: 'misconfigured' };
  if (!token) return { status: 'anonymous' };

  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
    });

    const userId =
      typeof payload.userId === 'string'
        ? payload.userId
        : typeof payload.sub === 'string'
          ? payload.sub
          : null;
    if (!userId) return { status: 'invalid' };

    const claims: AdminClaims = {
      userId,
      role: payload.role === 'ADMIN' ? 'ADMIN' : 'USER',
      exp: typeof payload.exp === 'number' ? payload.exp : undefined,
    };

    if (claims.role !== 'ADMIN') return { status: 'forbidden', claims };

    return { status: 'valid', claims };
  } catch {
    return { status: 'invalid' };
  }
}
