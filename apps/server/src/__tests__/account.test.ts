import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { Prisma, Role } from '@prisma/client';

import { buildApp } from '../index';
import { config } from '../config';
import { prisma } from '../config/prisma';
import { resetRateLimits } from '../services/rateLimit.service';
import { base32Decode, currentStep, hotp } from '../services/totp.service';

let app: FastifyInstance;

beforeAll(async () => {
  (config.turnstile as { disabled: boolean }).disabled = true;
  app = await buildApp({ logger: false });
  await app.ready();
});

beforeEach(() => resetRateLimits());

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const PASSWORD = 'correct horse battery staple 42';

async function makeUser(opts: { role?: Role; balance?: string } = {}) {
  const email = `acct-${Math.random().toString(16).slice(2)}@test.local`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await argon2.hash(PASSWORD),
      role: opts.role ?? Role.USER,
      wallets: { create: { currency: 'USD', balance: new Prisma.Decimal(opts.balance ?? '0') } },
    },
    select: { id: true, role: true },
  });
  const token = jwt.sign({ userId: user.id, role: user.role, tv: 0 }, config.jwtSecret, {
    subject: user.id,
    expiresIn: '5m',
  });
  return { id: user.id, email, token };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const codeFor = (secret: string, ahead = 1) => hotp(base32Decode(secret), currentStep() + ahead);

async function enable2fa(token: string) {
  const setup = await app.inject({ method: 'POST', url: '/api/account/2fa/setup', headers: auth(token) });
  expect(setup.statusCode).toBe(200);
  const { secret, otpauthUri } = setup.json() as { secret: string; otpauthUri: string };
  expect(otpauthUri).toMatch(/^otpauth:\/\/totp\/FRIGAT/);
  const enable = await app.inject({
    method: 'POST',
    url: '/api/account/2fa/enable',
    headers: auth(token),
    payload: { code: codeFor(secret, 0) },
  });
  expect(enable.statusCode).toBe(200);
  return { secret, backupCodes: (enable.json() as { backupCodes: string[] }).backupCodes };
}

describe('authenticator two-factor', () => {
  it('stays off until a correct code confirms the app, then issues 8 backup codes', async () => {
    const u = await makeUser();
    await app.inject({ method: 'POST', url: '/api/account/2fa/setup', headers: auth(u.token) });
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/account/2fa/enable',
      headers: auth(u.token),
      payload: { code: '000000' },
    });
    expect(wrong.statusCode).toBe(401);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).totpEnabled).toBe(false);

    const u2 = await makeUser();
    const { backupCodes } = await enable2fa(u2.token);
    expect(backupCodes).toHaveLength(8);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u2.id } });
    expect(row.totpEnabled).toBe(true);
    expect(row.totpSecret).not.toMatch(/^[A-Z2-7]{32}$/);
    expect(row.totpBackupCodes).not.toContain(backupCodes[0]);
  });

  it('signs in only after the code, and the challenge is useless as a session', async () => {
    const u = await makeUser({ role: Role.ADMIN });
    const { secret } = await enable2fa(u.token);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: u.email, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    const body = login.json() as { requiresTotp?: boolean; challenge?: string; token?: string };
    expect(body.requiresTotp).toBe(true);
    expect(body.token).toBeUndefined();

    const asSession = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(body.challenge!) });
    expect(asSession.statusCode).toBe(401);

    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/2fa/verify',
      payload: { challenge: body.challenge, code: '123456' },
    });
    expect(bad.statusCode).toBe(401);

    const code = codeFor(secret);
    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/2fa/verify',
      payload: { challenge: body.challenge, code },
    });
    expect(ok.statusCode).toBe(200);
    const session = (ok.json() as { token: string }).token;
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(session) });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { totpEnabled: boolean }).totpEnabled).toBe(true);

    const replay = await app.inject({
      method: 'POST',
      url: '/api/auth/2fa/verify',
      payload: { challenge: body.challenge, code },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('accepts each backup code once', async () => {
    const u = await makeUser({ role: Role.ADMIN });
    const { backupCodes } = await enable2fa(u.token);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: u.email, password: PASSWORD },
    });
    const { challenge } = login.json() as { challenge: string };
    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/2fa/verify',
      payload: { challenge, code: backupCodes[3].toLowerCase() },
    });
    expect(first.statusCode).toBe(200);
    const again = await app.inject({
      method: 'POST',
      url: '/api/auth/2fa/verify',
      payload: { challenge, code: backupCodes[3] },
    });
    expect(again.statusCode).toBe(401);
  });

  it('will not turn off without a valid code', async () => {
    const u = await makeUser();
    const { secret } = await enable2fa(u.token);
    const noCode = await app.inject({ method: 'POST', url: '/api/account/2fa/disable', headers: auth(u.token), payload: {} });
    expect(noCode.statusCode).toBe(401);
    const off = await app.inject({
      method: 'POST',
      url: '/api/account/2fa/disable',
      headers: auth(u.token),
      payload: { code: codeFor(secret) },
    });
    expect(off.statusCode).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.totpEnabled).toBe(false);
    expect(row.totpSecret).toBeNull();
  });
});

describe('telegram link (trial)', () => {
  it('validates, stores and removes the username', async () => {
    const u = await makeUser();
    const bad = await app.inject({
      method: 'POST',
      url: '/api/account/telegram',
      headers: auth(u.token),
      payload: { username: 'no' },
    });
    expect(bad.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/account/telegram',
      headers: auth(u.token),
      payload: { username: '@frigat_player' },
    });
    expect(ok.statusCode).toBe(200);
    const security = await app.inject({ method: 'GET', url: '/api/account/security', headers: auth(u.token) });
    expect((security.json() as { telegram: { username: string } }).telegram.username).toBe('frigat_player');

    await app.inject({ method: 'DELETE', url: '/api/account/telegram', headers: auth(u.token) });
    const after = await app.inject({ method: 'GET', url: '/api/account/security', headers: auth(u.token) });
    expect((after.json() as { telegram: unknown }).telegram).toBeNull();
  });

  it('refuses without a session', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/account/telegram', payload: { username: 'someone_x' } });
    expect(res.statusCode).toBe(401);
  });
});

describe('deleting the account', () => {
  it('refuses while there is a balance, and with a wrong password', async () => {
    const rich = await makeUser({ balance: '12.50' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/account/delete',
      headers: auth(rich.token),
      payload: { password: PASSWORD },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('balance_not_empty');

    const u = await makeUser();
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/account/delete',
      headers: auth(u.token),
      payload: { password: 'not it' },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('scrubs and freezes the account, and ends every session', async () => {
    const u = await makeUser();
    const res = await app.inject({
      method: 'POST',
      url: '/api/account/delete',
      headers: auth(u.token),
      payload: { password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.email).toBe(`deleted+${u.id}@deleted.invalid`);
    expect(row.frozen).toBe(true);
    expect(row.deletedAt).not.toBeNull();
    expect(row.tokenVersion).toBe(1);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(u.token) });
    expect(me.statusCode).toBe(401);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: u.email, password: PASSWORD },
    });
    expect(login.statusCode).toBe(401);
  });

  it('needs the authenticator code too when 2FA is on', async () => {
    const u = await makeUser();
    const { secret } = await enable2fa(u.token);
    const noCode = await app.inject({
      method: 'POST',
      url: '/api/account/delete',
      headers: auth(u.token),
      payload: { password: PASSWORD },
    });
    expect(noCode.statusCode).toBe(401);
    const ok = await app.inject({
      method: 'POST',
      url: '/api/account/delete',
      headers: auth(u.token),
      payload: { password: PASSWORD, code: codeFor(secret) },
    });
    expect(ok.statusCode).toBe(200);
  });
});
