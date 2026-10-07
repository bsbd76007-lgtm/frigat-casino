import jwt from 'jsonwebtoken';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config';
import { prisma } from '../config/prisma';

export interface AuthedIdentity {
  userId: string;
  role: 'USER' | 'ADMIN';
}

interface FrigatJwtClaims extends jwt.JwtPayload {
  sub?: string;
  userId?: string;
  role?: 'USER' | 'ADMIN';
  tv?: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    identity?: AuthedIdentity;
    sessionChecked?: boolean;
  }
}

function claimsFromRequest(req: FastifyRequest): FrigatJwtClaims | null {
  const token = bearerToken(req) ?? cookieToken(req);
  if (!token) return null;

  try {
    return jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
    }) as FrigatJwtClaims;
  } catch {
    return null;
  }
}

export function registerSessionGuard(app: FastifyInstance) {
  app.addHook('onRequest', async (req) => {
    if (req.method === 'OPTIONS') return;

    req.sessionChecked = true;

    const claims = claimsFromRequest(req);
    if (!claims) return;

    const userId = claims.userId ?? claims.sub;
    if (!userId) return;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true, role: true },
    });
    if (!user) return;
    if ((claims.tv ?? 0) !== user.tokenVersion) {
      req.log.info({ userId }, 'token rejected — superseded by a newer tokenVersion');
      return;
    }

    req.identity = { userId, role: user.role === 'ADMIN' ? 'ADMIN' : 'USER' };
  });
}

const SESSION_COOKIE = 'token';

function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

function cookieToken(req: FastifyRequest): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;

    try {
      return decodeURIComponent(part.slice(eq + 1).trim()) || null;
    } catch {
      return null;
    }
  }
  return null;
}

export function identityFromRequest(req: FastifyRequest): AuthedIdentity | null {
  if (req.sessionChecked) return req.identity ?? null;

  const claims = claimsFromRequest(req);
  const userId = claims?.userId ?? claims?.sub;
  if (!claims || !userId) return null;

  return { userId, role: claims.role === 'ADMIN' ? 'ADMIN' : 'USER' };
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const identity = identityFromRequest(req);

  if (!identity) {
    await reply.code(401).send({ error: 'unauthorized' });
    return reply;
  }
  if (identity.role !== 'ADMIN') {
    req.log.warn({ userId: identity.userId }, 'non-admin blocked from admin route');
    await reply.code(403).send({ error: 'forbidden' });
    return reply;
  }

  req.identity = identity;
}
