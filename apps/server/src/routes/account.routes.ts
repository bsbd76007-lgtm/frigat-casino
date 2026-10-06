/**
 * The signed-in player's account security: authenticator two-factor, the
 * Telegram link, and deleting the account.
 *
 * Every route here acts on the caller's own row — the id always comes from the
 * session, never from the request — and every route that accepts a code sits
 * behind the same per-IP and per-account throttles as sign-in.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';

import { prisma } from '../config/prisma';
import { identityFromRequest } from '../middleware/auth';
import { clearThrottle, recordAccountFailure, throttled } from '../services/rateLimit.service';
import {
  generateBackupCodes,
  generateSecret,
  matchStep,
  openSecret,
  otpauthUri,
  sealSecret,
  spendSecondFactor,
} from '../services/totp.service';
import { gameState } from '../websocket/gameState.store';

/** Telegram's own rule: 5–32 characters, letters, digits and underscores. */
const TELEGRAM_USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

/** Withdrawals still in flight — deleting under one would strand the money. */
const OPEN_WITHDRAWALS = ['PENDING', 'PENDING_ADMIN_REVIEW', 'CONFIRMING'] as const;

function requireUser(req: FastifyRequest, reply: FastifyReply): string | null {
  const identity = identityFromRequest(req);
  if (!identity) {
    void reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return identity.userId;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function registerAccountRoutes(app: FastifyInstance) {
  /**
   * GET /api/account/security
   * What the account panel's security section shows.
   */
  app.get('/api/account/security', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return reply;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        totpEnabled: true,
        totpBackupCodes: true,
        telegramUsername: true,
        telegramLinkedAt: true,
      },
    });
    if (!user) return reply.code(404).send({ error: 'user_not_found' });

    return reply.send({
      totpEnabled: user.totpEnabled,
      backupCodesRemaining: user.totpEnabled ? user.totpBackupCodes.length : 0,
      telegram: user.telegramUsername
        ? { username: user.telegramUsername, linkedAt: user.telegramLinkedAt }
        : null,
    });
  });

  // ── Authenticator two-factor ─────────────────────────

  /**
   * POST /api/account/2fa/setup
   *
   * Issues a fresh secret and stores it sealed, but leaves 2FA *off*: nothing
   * changes about sign-in until /enable proves the player's app produces the
   * right codes. Calling it again replaces an unconfirmed secret.
   */
  app.post('/api/account/2fa/setup', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return reply;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, totpEnabled: true },
    });
    if (!user) return reply.code(404).send({ error: 'user_not_found' });
    if (user.totpEnabled) {
      return reply.code(409).send({
        error: 'totp_already_enabled',
        message: 'Two-factor sign-in is already on. Turn it off first to set up a new app.',
      });
    }

    const secret = generateSecret();
    await prisma.user.update({
      where: { id: userId },
      data: { totpSecret: sealSecret(secret), totpLastStep: null, totpBackupCodes: [] },
    });

    return reply.send({ secret, otpauthUri: otpauthUri(secret, user.email) });
  });

  /**
   * POST /api/account/2fa/enable  { code }
   *
   * Turns 2FA on once a code from the pending secret checks out, and returns
   * the backup codes — the only time they are ever shown.
   */
  app.post<{ Body: { code?: unknown } }>('/api/account/2fa/enable', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return reply;

    if (throttled(req.ip, 'totp-setup', userId)) {
      return reply.code(429).send({
        error: 'too_many_requests',
        message: 'Too many attempts. Please wait a few minutes and try again.',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { totpSecret: true, totpEnabled: true },
    });
    if (!user) return reply.code(404).send({ error: 'user_not_found' });
    if (user.totpEnabled) {
      return reply.code(409).send({ error: 'totp_already_enabled', message: 'Two-factor sign-in is already on.' });
    }
    const secret = user.totpSecret ? openSecret(user.totpSecret) : null;
    if (!secret) {
      return reply.code(409).send({
        error: 'totp_not_set_up',
        message: 'Start the setup again — no authenticator is waiting to be confirmed.',
      });
    }

    const step = matchStep(secret, str(req.body?.code).replace(/\s/g, ''), null);
    if (step === null) {
      recordAccountFailure('totp-setup', userId);
      return reply.code(401).send({
        error: 'invalid_totp',
        message: 'That code is not valid. Check the time on your phone and try the newest code.',
      });
    }

    const { codes, hashes } = generateBackupCodes();
    await prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: true, totpLastStep: step, totpBackupCodes: hashes },
    });
    clearThrottle(req.ip, 'totp-setup', userId);
    req.log.info({ userId }, 'two-factor sign-in enabled');

    return reply.send({ enabled: true, backupCodes: codes });
  });

  /**
   * POST /api/account/2fa/disable  { code }
   *
   * Needs a current code (or a backup code): a session alone must not be able
   * to strip the second factor, or a stolen session could make itself
   * permanent.
   */
  app.post<{ Body: { code?: unknown } }>('/api/account/2fa/disable', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return reply;

    if (throttled(req.ip, 'totp-disable', userId)) {
      return reply.code(429).send({
        error: 'too_many_requests',
        message: 'Too many attempts. Please wait a few minutes and try again.',
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { totpEnabled: true } });
    if (!user) return reply.code(404).send({ error: 'user_not_found' });
    if (!user.totpEnabled) return reply.send({ enabled: false });

    if (!(await spendSecondFactor(userId, str(req.body?.code)))) {
      recordAccountFailure('totp-disable', userId);
      return reply.code(401).send({
        error: 'invalid_totp',
        message: 'That code is not valid. Use a code from your app or one of your backup codes.',
      });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: false, totpSecret: null, totpLastStep: null, totpBackupCodes: [] },
    });
    clearThrottle(req.ip, 'totp-disable', userId);
    req.log.warn({ userId }, 'two-factor sign-in disabled');

    return reply.send({ enabled: false });
  });

  // ── Telegram (trial) ─────────────────────────────────
  //
  // A trial link: the username is stored and shown, but no bot confirms the
  // player owns it yet, so nothing may trust it — no notifications, no sign-in,
  // no payouts keyed off it. `telegramId`, which a real bot login would fill,
  // is deliberately left alone.

  /** POST /api/account/telegram  { username } */
  app.post<{ Body: { username?: unknown } }>('/api/account/telegram', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return reply;

    const username = str(req.body?.username).replace(/^@/, '');
    if (!TELEGRAM_USERNAME.test(username)) {
      return reply.code(400).send({
        error: 'invalid_telegram_username',
        message: 'Enter a Telegram username: 5–32 letters, digits or underscores.',
      });
    }

    const linkedAt = new Date();
    await prisma.user.update({
      where: { id: userId },
      data: { telegramUsername: username, telegramLinkedAt: linkedAt },
    });
    return reply.send({ telegram: { username, linkedAt } });
  });

  /** DELETE /api/account/telegram */
  app.delete('/api/account/telegram', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return reply;

    await prisma.user.update({
      where: { id: userId },
      data: { telegramUsername: null, telegramLinkedAt: null },
    });
    return reply.send({ telegram: null });
  });

  // ── Deleting the account ─────────────────────────────

  /**
   * POST /api/account/delete  { password, code? }
   *
   * Not a row delete: settled bets, ledger entries and audit rows reference
   * the user, and money records are not ours to erase. The account is instead
   * made unusable and anonymous in one write —
   *
   *   - email replaced with a unique placeholder, so the address is free to
   *     register again and no longer identifies anyone;
   *   - password replaced with an unguessable hash, Telegram and 2FA cleared;
   *   - frozen, so the ledger refuses any bet and the socket refuses to connect;
   *   - tokenVersion bumped, so every session already issued stops working.
   *
   * Refused while there is money or play still in motion: a balance above
   * zero, an open withdrawal, or a Mines / Chicken round in progress. Deleting
   * under any of those would strand funds on an account nobody can reach.
   */
  app.post<{ Body: { password?: unknown; code?: unknown } }>(
    '/api/account/delete',
    async (req, reply) => {
      const userId = requireUser(req, reply);
      if (!userId) return reply;

      if (throttled(req.ip, 'account-delete', userId)) {
        return reply.code(429).send({
          error: 'too_many_requests',
          message: 'Too many attempts. Please wait a few minutes and try again.',
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          role: true,
          passwordHash: true,
          totpEnabled: true,
          deletedAt: true,
          wallets: { select: { balance: true } },
        },
      });
      if (!user || user.deletedAt) return reply.code(404).send({ error: 'user_not_found' });

      if (user.role === 'ADMIN') {
        return reply.code(403).send({
          error: 'admin_cannot_self_delete',
          message: 'Admin accounts cannot be deleted from here. Ask another admin to remove the role first.',
        });
      }

      const passwordOk = await argon2.verify(user.passwordHash, str(req.body?.password)).catch(() => false);
      if (!passwordOk) {
        recordAccountFailure('account-delete', userId);
        return reply.code(401).send({ error: 'invalid_password', message: 'That password is not correct.' });
      }
      if (user.totpEnabled && !(await spendSecondFactor(userId, str(req.body?.code)))) {
        recordAccountFailure('account-delete', userId);
        return reply.code(401).send({
          error: 'invalid_totp',
          message: 'Enter a valid code from your authenticator app or a backup code.',
        });
      }

      if (user.wallets.some((w) => new Prisma.Decimal(w.balance).gt(0))) {
        return reply.code(409).send({
          error: 'balance_not_empty',
          message: 'Withdraw your balance before deleting the account.',
        });
      }
      const openWithdrawal = await prisma.withdrawal.findFirst({
        where: { userId, status: { in: [...OPEN_WITHDRAWALS] } },
        select: { id: true },
      });
      if (openWithdrawal) {
        return reply.code(409).send({
          error: 'withdrawal_pending',
          message: 'A withdrawal is still being processed. Try again once it has completed.',
        });
      }
      if (gameState.getMines(userId)?.active || gameState.getChicken(userId)?.active) {
        return reply.code(409).send({
          error: 'game_in_progress',
          message: 'Finish your current round before deleting the account.',
        });
      }

      const scrubbed = await argon2.hash(randomBytes(32).toString('hex'));
      await prisma.user.update({
        where: { id: userId },
        data: {
          email: `deleted+${userId}@deleted.invalid`,
          passwordHash: scrubbed,
          tokenVersion: { increment: 1 },
          frozen: true,
          frozenAt: new Date(),
          frozenReason: 'Deleted by the account holder',
          deletedAt: new Date(),
          telegramId: null,
          telegramUsername: null,
          telegramLinkedAt: null,
          totpEnabled: false,
          totpSecret: null,
          totpLastStep: null,
          totpBackupCodes: [],
        },
      });
      clearThrottle(req.ip, 'account-delete', userId);
      req.log.warn({ userId }, 'account deleted by its holder');

      return reply.send({ deleted: true });
    }
  );
}
