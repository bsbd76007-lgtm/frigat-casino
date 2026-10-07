import jwt from 'jsonwebtoken';
import type { IncomingMessage } from 'http';
import { config } from '../config';
import { prisma } from '../config/prisma';

export interface AuthedIdentity {
  userId: string;
  role: 'USER' | 'ADMIN';
  tokenVersion: number;
}

interface FrigatJwtClaims extends jwt.JwtPayload {
  sub?: string;
  userId?: string;
  role?: 'USER' | 'ADMIN';
  tv?: number;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

function extractToken(req: IncomingMessage): string | null {
  const header = req.headers['authorization'];
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }

  try {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
    const q = url.searchParams.get('token');
    if (q) return q;
  } catch {
  }

  return null;
}

export function authenticateConnection(req: IncomingMessage): AuthedIdentity {
  const token = extractToken(req);
  if (!token) throw new AuthError('Missing authentication token');

  let claims: FrigatJwtClaims;
  try {
    claims = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
    }) as FrigatJwtClaims;
  } catch (err) {
    throw new AuthError(
      err instanceof jwt.TokenExpiredError ? 'Token expired' : 'Invalid token'
    );
  }

  const userId = claims.userId ?? claims.sub;
  if (!userId) throw new AuthError('Token missing subject');

  const role = claims.role === 'ADMIN' ? 'ADMIN' : 'USER';
  return { userId, role, tokenVersion: claims.tv ?? 0 };
}

export async function verifyConnection(
  identity: AuthedIdentity
): Promise<{ userId: string; role: 'ADMIN' | 'USER'; email: string | null }> {
  const user = await prisma.user.findUnique({
    where: { id: identity.userId },
    select: { tokenVersion: true, role: true, frozen: true, email: true },
  });

  if (!user) throw new AuthError('Invalid token');
  if (identity.tokenVersion !== user.tokenVersion) {
    throw new AuthError('Session expired');
  }
  if (user.frozen) throw new AuthError('Account is frozen');

  return {
    userId: identity.userId,
    role: user.role === 'ADMIN' ? 'ADMIN' : 'USER',
    email: user.email ?? null,
  };
}
