import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { Prisma, Role } from '@prisma/client';

import { config } from '../config';
import { prisma } from '../config/prisma';

export const OTP_POLICY = {
  digits: 6,
  ttlMs: 5 * 60 * 1000,
  resetTtlMs: 10 * 60 * 1000,
  resendCooldownMs: 60 * 1000,
  maxAttemptsPerCode: 5,
  maxAttemptsPerEmail: 15,
  attemptWindowMs: 15 * 60 * 1000,
} as const;

export class OtpCooldownError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('A code was already sent recently');
    this.name = 'OtpCooldownError';
  }
}

export class OtpTooManyAttemptsError extends Error {
  constructor() {
    super('Too many incorrect codes');
    this.name = 'OtpTooManyAttemptsError';
  }
}

function hashCode(email: string, code: string): string {
  return createHmac('sha256', config.jwtSecret)
    .update(`otp:${email}:${code}`)
    .digest('hex');
}

function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function generateCode(): string {
  let code = '';
  for (let i = 0; i < OTP_POLICY.digits; i += 1) code += randomInt(0, 10).toString();
  return code;
}

export interface IssuedOtp {
  code: string;
  expiresAt: Date;
}

export type OtpPurpose = 'LOGIN' | 'REGISTER' | 'PASSWORD_RESET';

export interface IssueOtpOptions {
  purpose?: OtpPurpose;
  passwordHash?: string | null;
  ttlMs?: number;
}

export async function issueOtp(
  email: string,
  options: IssueOtpOptions = {}
): Promise<IssuedOtp> {
  const { purpose = 'LOGIN', passwordHash = null, ttlMs = OTP_POLICY.ttlMs } = options;
  const now = new Date();

  const latest = await prisma.otpCode.findFirst({
    where: { email },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  if (latest) {
    const elapsed = now.getTime() - latest.createdAt.getTime();
    if (elapsed < OTP_POLICY.resendCooldownMs) {
      throw new OtpCooldownError(
        Math.ceil((OTP_POLICY.resendCooldownMs - elapsed) / 1000)
      );
    }
  }

  const code = generateCode();
  const expiresAt = new Date(now.getTime() + ttlMs);

  await prisma.$transaction([
    prisma.otpCode.updateMany({
      where: { email, used: false },
      data: { used: true },
    }),
    prisma.otpCode.create({
      data: {
        email,
        codeHash: hashCode(email, code),
        expiresAt,
        purpose,
        passwordHash: purpose === 'REGISTER' ? passwordHash : null,
      },
    }),
  ]);

  return { code, expiresAt };
}

export async function discardOtp(email: string): Promise<void> {
  await prisma.otpCode.deleteMany({ where: { email, used: false } });
}

export type OtpFailure = 'no_code' | 'expired' | 'incorrect' | 'exhausted';

export type OtpVerification =
  | { ok: true; purpose: OtpPurpose; passwordHash: string | null }
  | { ok: false; reason: OtpFailure; attemptsLeft?: number };

export async function verifyOtp(
  email: string,
  code: string,
  purpose: OtpPurpose = 'LOGIN'
): Promise<OtpVerification> {
  const recentFailures = await prisma.otpCode.aggregate({
    where: {
      email,
      createdAt: { gte: new Date(Date.now() - OTP_POLICY.attemptWindowMs) },
    },
    _sum: { attempts: true },
  });
  if ((recentFailures._sum.attempts ?? 0) >= OTP_POLICY.maxAttemptsPerEmail) {
    throw new OtpTooManyAttemptsError();
  }

  const record = await prisma.otpCode.findFirst({
    where: { email, used: false, purpose },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      codeHash: true,
      expiresAt: true,
      attempts: true,
      passwordHash: true,
    },
  });

  if (!record) return { ok: false, reason: 'no_code' };

  if (record.expiresAt.getTime() <= Date.now()) {
    await prisma.otpCode.update({ where: { id: record.id }, data: { used: true } });
    return { ok: false, reason: 'expired' };
  }

  if (record.attempts >= OTP_POLICY.maxAttemptsPerCode) {
    await prisma.otpCode.update({ where: { id: record.id }, data: { used: true } });
    return { ok: false, reason: 'exhausted' };
  }

  if (!digestsMatch(record.codeHash, hashCode(email, code))) {
    const updated = await prisma.otpCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    const attemptsLeft = Math.max(0, OTP_POLICY.maxAttemptsPerCode - updated.attempts);
    if (attemptsLeft === 0) {
      await prisma.otpCode.update({ where: { id: record.id }, data: { used: true } });
    }
    return { ok: false, reason: 'incorrect', attemptsLeft };
  }

  const consumed = await prisma.otpCode.updateMany({
    where: { id: record.id, used: false },
    data: { used: true },
  });
  if (consumed.count !== 1) return { ok: false, reason: 'no_code' };

  return { ok: true, purpose, passwordHash: record.passwordHash };
}

export interface OtpAccount {
  id: string;
  email: string;
  role: Role;
  createdAt: Date;
  frozen: boolean;
  created: boolean;
}

export async function findOrCreateOtpUser(
  email: string,
  referredById: string | null = null
): Promise<OtpAccount> {
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true, createdAt: true, frozen: true },
  });
  if (existing) return { ...existing, created: false };

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        passwordHash: 'otp-only-account:no-password-set',
        role: Role.USER,
        referredById,
      },
      select: { id: true, email: true, role: true, createdAt: true, frozen: true },
    });

    await tx.wallet.create({ data: { userId: user.id, currency: 'USD' } });
    return user;
  });

  return { ...created, created: true };
}

export async function purgeExpiredOtps(olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const { count } = await prisma.otpCode.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: cutoff } }, { used: true, createdAt: { lt: cutoff } }],
    },
  });
  return count;
}

export type { Prisma };
