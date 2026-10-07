import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

import { config } from '../config';
import { prisma } from '../config/prisma';

export const TOTP = {
  digits: 6,
  stepSeconds: 30,
  window: 1,
  issuer: 'FRIGAT',
  backupCodes: 8,
} as const;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(binary % 10 ** TOTP.digits).padStart(TOTP.digits, '0');
}

export function currentStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP.stepSeconds);
}

export function matchStep(
  base32Secret: string,
  code: string,
  lastStep: number | null,
  nowMs = Date.now()
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(base32Secret);
  const now = currentStep(nowMs);
  for (let delta = -TOTP.window; delta <= TOTP.window; delta += 1) {
    const step = now + delta;
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(hotp(secret, step));
    const given = Buffer.from(code);
    if (timingSafeEqual(expected, given)) return step;
  }
  return null;
}

export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function otpauthUri(base32Secret: string, account: string): string {
  const label = encodeURIComponent(`${TOTP.issuer}:${account}`);
  const params = new URLSearchParams({
    secret: base32Secret,
    issuer: TOTP.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP.digits),
    period: String(TOTP.stepSeconds),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

const sealKey = createHash('sha256').update(`frigat:totp-seal:${config.jwtSecret}`).digest();

export function sealSecret(base32Secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealKey, iv);
  const body = Buffer.concat([cipher.update(base32Secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, body].map((b) => b.toString('base64url')).join('.');
}

export function openSecret(sealed: string): string | null {
  const [iv, tag, body] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', sealKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function normaliseBackup(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashBackupCode(code: string): string {
  return createHmac('sha256', `frigat:totp-backup:${config.jwtSecret}`)
    .update(normaliseBackup(code))
    .digest('hex');
}

export function generateBackupCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: TOTP.backupCodes }, () => {
    const raw = base32Encode(randomBytes(5)).slice(0, 8);
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
  return { codes, hashes: codes.map(hashBackupCode) };
}

export function findBackupCode(code: string, hashes: readonly string[]): number {
  if (normaliseBackup(code).length !== 8) return -1;
  const given = Buffer.from(hashBackupCode(code), 'hex');
  let found = -1;
  hashes.forEach((stored, i) => {
    const candidate = Buffer.from(stored, 'hex');
    if (candidate.length === given.length && timingSafeEqual(candidate, given)) found = i;
  });
  return found;
}

export interface SecondFactorState {
  totpSecret: string | null;
  totpLastStep: number | null;
  totpBackupCodes: string[];
}

export type SecondFactorResult =
  | { ok: true; via: 'totp'; step: number }
  | { ok: true; via: 'backup'; remaining: string[] }
  | { ok: false };

export function checkSecondFactor(state: SecondFactorState, input: string): SecondFactorResult {
  const code = input.trim();
  if (state.totpSecret) {
    const secret = openSecret(state.totpSecret);
    if (secret) {
      const step = matchStep(secret, code.replace(/\s/g, ''), state.totpLastStep);
      if (step !== null) return { ok: true, via: 'totp', step };
    }
  }
  const index = findBackupCode(code, state.totpBackupCodes);
  if (index >= 0) {
    return {
      ok: true,
      via: 'backup',
      remaining: state.totpBackupCodes.filter((_, i) => i !== index),
    };
  }
  return { ok: false };
}

export async function spendSecondFactor(userId: string, input: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecret: true, totpLastStep: true, totpBackupCodes: true },
  });
  if (!user) return false;

  const result = checkSecondFactor(user, input);
  if (!result.ok) return false;

  if (result.via === 'totp') {
    const { count } = await prisma.user.updateMany({
      where: {
        id: userId,
        OR: [{ totpLastStep: null }, { totpLastStep: { lt: result.step } }],
      },
      data: { totpLastStep: result.step },
    });
    return count === 1;
  }

  const spent = user.totpBackupCodes.find((h) => !result.remaining.includes(h));
  if (!spent) return false;
  const { count } = await prisma.user.updateMany({
    where: { id: userId, totpBackupCodes: { has: spent } },
    data: { totpBackupCodes: result.remaining },
  });
  return count === 1;
}
