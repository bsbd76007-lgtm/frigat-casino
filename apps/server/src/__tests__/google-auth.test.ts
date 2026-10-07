import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { Prisma, Role } from '@prisma/client';

vi.mock('../services/googleAuth.service', () => ({
  googleSignInEnabled: () => true,
  verifyGoogleIdToken: vi.fn(),
  verifyGoogleAccessToken: vi.fn(),
  exchangeGoogleCode: vi.fn(),
  allowedRedirectUri: (uri: string) => uri === 'http://localhost:3000/api/auth/google/callback',
  googleCodeExchangeEnabled: vi.fn(() => true),
}));

import { buildApp } from '../index';
import { config } from '../config';
import { prisma } from '../config/prisma';
import { resetRateLimits } from '../services/rateLimit.service';
import {
  exchangeGoogleCode,
  googleCodeExchangeEnabled,
  verifyGoogleAccessToken,
  verifyGoogleIdToken,
} from '../services/googleAuth.service';
import { base32Decode, currentStep, hotp } from '../services/totp.service';

const verifyMock = vi.mocked(verifyGoogleIdToken);
const verifyAccessMock = vi.mocked(verifyGoogleAccessToken);
const exchangeMock = vi.mocked(exchangeGoogleCode);
const codeEnabledMock = vi.mocked(googleCodeExchangeEnabled);

let app: FastifyInstance;

beforeAll(async () => {
  (config.turnstile as { disabled: boolean }).disabled = true;
  app = await buildApp({ logger: false });
  await app.ready();
});

beforeEach(() => {
  resetRateLimits();
  verifyMock.mockReset();
  verifyAccessMock.mockReset();
  exchangeMock.mockReset();
  codeEnabledMock.mockReturnValue(true);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const PASSWORD = 'correct horse battery staple 42';
const unique = () => Math.random().toString(16).slice(2);

function googleAs(email: string, googleId = `g-${unique()}`) {
  verifyMock.mockResolvedValue({ email, googleId });
  return googleId;
}

const signIn = (token = 'id-token') =>
  app.inject({ method: 'POST', url: '/api/auth/google', payload: { token } });

async function makePasswordUser(email: string) {
  return prisma.user.create({
    data: {
      email,
      passwordHash: await argon2.hash(PASSWORD),
      role: Role.USER,
      wallets: { create: { currency: 'USD', balance: new Prisma.Decimal('0') } },
    },
    select: { id: true, role: true },
  });
}

const bearer = (userId: string, role: Role = Role.USER) => ({
  authorization: `Bearer ${jwt.sign({ userId, role, tv: 0 }, config.jwtSecret, {
    subject: userId,
    expiresIn: '5m',
  })}`,
});

describe('POST /api/auth/google', () => {
  it('creates a passwordless account with a USD wallet on first sign-in', async () => {
    const email = `new-${unique()}@gmail.test`;
    const googleId = googleAs(email);

    const res = await signIn();
    expect(res.statusCode).toBe(201);
    const body = res.json() as { token: string; created: boolean; user: { id: string; email: string } };
    expect(body.created).toBe(true);
    expect(body.user.email).toBe(email);

    const claims = jwt.verify(body.token, config.jwtSecret) as jwt.JwtPayload;
    expect(claims.sub).toBe(body.user.id);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: body.user.id },
      include: { wallets: true },
    });
    expect(user.googleId).toBe(googleId);
    expect(user.passwordHash).toBeNull();
    expect(user.wallets.map((w) => w.currency)).toEqual(['USD']);
  });

  it('signs the same Google account back in without creating a second user', async () => {
    const email = `again-${unique()}@gmail.test`;
    googleAs(email);
    const first = (await signIn()).json() as { user: { id: string } };

    const second = await signIn();
    expect(second.statusCode).toBe(200);
    const body = second.json() as { created: boolean; user: { id: string } };
    expect(body.created).toBe(false);
    expect(body.user.id).toBe(first.user.id);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it('links Google to an existing password account with the same email and keeps the password', async () => {
    const email = `linked-${unique()}@gmail.test`;
    const existing = await makePasswordUser(email);
    const googleId = googleAs(email);

    const res = await signIn();
    expect(res.statusCode).toBe(200);
    expect((res.json() as { user: { id: string } }).user.id).toBe(existing.id);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(user.googleId).toBe(googleId);
    expect(user.passwordHash).not.toBeNull();
  });

  it('signs in with an authorization code exchanged on the server', async () => {
    const email = `code-${unique()}@gmail.test`;
    exchangeMock.mockResolvedValue({ email, googleId: `g-${unique()}` });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/google',
      payload: { code: '4/0Aexample' },
    });
    expect(res.statusCode).toBe(201);
    expect(exchangeMock).toHaveBeenCalledWith('4/0Aexample', undefined, expect.anything());
    expect(verifyMock).not.toHaveBeenCalled();
    expect(verifyAccessMock).not.toHaveBeenCalled();
    expect((res.json() as { user: { email: string } }).user.email).toBe(email);
  });

  it('exchanges a redirect-flow code with the callback address it was issued for', async () => {
    const email = `redirect-${unique()}@gmail.test`;
    exchangeMock.mockResolvedValue({ email, googleId: `g-${unique()}` });
    const redirectUri = 'http://localhost:3000/api/auth/google/callback';

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/google',
      payload: { code: '4/0Aredirect', redirectUri },
    });
    expect(res.statusCode).toBe(201);
    expect(exchangeMock).toHaveBeenCalledWith('4/0Aredirect', redirectUri, expect.anything());
  });

  it('refuses a redirect_uri that is not one of our callbacks', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/google',
      payload: { code: '4/0Aredirect', redirectUri: 'https://evil.example/api/auth/google/callback' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_redirect_uri');
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it('rejects a code Google will not exchange', async () => {
    exchangeMock.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/google',
      payload: { code: '4/expired' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('reports a missing client secret instead of trying the exchange', async () => {
    codeEnabledMock.mockReturnValue(false);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/google',
      payload: { code: '4/0Aexample' },
    });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: string }).error).toBe('google_unavailable');
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it('signs in with a popup access token through the access-token verifier', async () => {
    const email = `access-${unique()}@gmail.test`;
    verifyAccessMock.mockResolvedValue({ email, googleId: `g-${unique()}` });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/google',
      payload: { accessToken: 'ya29.popup' },
    });
    expect(res.statusCode).toBe(201);
    expect(verifyAccessMock).toHaveBeenCalledWith('ya29.popup');
    expect(verifyMock).not.toHaveBeenCalled();
    expect((res.json() as { user: { email: string } }).user.email).toBe(email);
  });

  it('rejects an access token the verifier refuses', async () => {
    verifyAccessMock.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/google',
      payload: { accessToken: 'ya29.foreign' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a token Google does not verify', async () => {
    verifyMock.mockResolvedValue(null);
    const res = await signIn('forged');
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBe('invalid_google_token');
  });

  it('refuses an email already linked to a different Google account', async () => {
    const email = `mismatch-${unique()}@gmail.test`;
    googleAs(email, `g-original-${unique()}`);
    expect((await signIn()).statusCode).toBe(201);

    googleAs(email, `g-other-${unique()}`);
    const res = await signIn();
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('google_account_mismatch');
  });

  it('still asks for the authenticator code when 2FA is on', async () => {
    const email = `totp-${unique()}@gmail.test`;
    const user = await makePasswordUser(email);
    const setup = await app.inject({
      method: 'POST',
      url: '/api/account/2fa/setup',
      headers: bearer(user.id),
    });
    const { secret } = setup.json() as { secret: string };
    const enable = await app.inject({
      method: 'POST',
      url: '/api/account/2fa/enable',
      headers: bearer(user.id),
      payload: { code: hotp(base32Decode(secret), currentStep()) },
    });
    expect(enable.statusCode).toBe(200);

    googleAs(email);
    const res = await signIn();
    expect(res.statusCode).toBe(200);
    const body = res.json() as { requiresTotp?: boolean; challenge?: string; token?: string };
    expect(body.requiresTotp).toBe(true);
    expect(typeof body.challenge).toBe('string');
    expect(body.token).toBeUndefined();
  });
});

describe('passwordless accounts on the password paths', () => {
  it('cannot sign in with a password', async () => {
    const email = `nopass-${unique()}@gmail.test`;
    googleAs(email);
    expect((await signIn()).statusCode).toBe(201);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: PASSWORD },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBe('invalid_credentials');
  });

  it('is told to set a password before deleting the account', async () => {
    const email = `delete-${unique()}@gmail.test`;
    googleAs(email);
    const { user } = (await signIn()).json() as { user: { id: string } };

    const res = await app.inject({
      method: 'POST',
      url: '/api/account/delete',
      headers: bearer(user.id),
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('password_not_set');
  });

  it('frees the Google link when a linked account is deleted', async () => {
    const email = `freed-${unique()}@gmail.test`;
    const existing = await makePasswordUser(email);
    const googleId = googleAs(email);
    expect((await signIn()).statusCode).toBe(200);

    const del = await app.inject({
      method: 'POST',
      url: '/api/account/delete',
      headers: bearer(existing.id),
      payload: { password: PASSWORD },
    });
    expect(del.statusCode).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: existing.id } })).googleId).toBeNull();

    googleAs(email, googleId);
    const again = await signIn();
    expect(again.statusCode).toBe(201);
    expect((again.json() as { user: { id: string } }).user.id).not.toBe(existing.id);
  });
});
