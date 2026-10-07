import { Prisma, TransactionType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { auditWithin } from './audit.service';
import { assertWagerAllowed } from './riskConfig.service';
import { HOUSE_EDGE } from '../config/game.config';

const D = Prisma.Decimal;

export class InsufficientFundsError extends Error {
  constructor() {
    super('Insufficient funds');
    this.name = 'InsufficientFundsError';
  }
}

export class WalletNotFoundError extends Error {
  constructor() {
    super('Wallet not found');
    this.name = 'WalletNotFoundError';
  }
}

export class AccountFrozenError extends Error {
  constructor() {
    super('Account is frozen');
    this.name = 'AccountFrozenError';
  }
}

function toAmount(amount: string | number, field = 'amount'): Prisma.Decimal {
  let dec: Prisma.Decimal;
  try {
    dec = new D(amount);
  } catch {
    throw new Error(`ledger: invalid ${field}`);
  }
  if (!dec.isFinite() || dec.lessThanOrEqualTo(0)) {
    throw new Error(`ledger: ${field} must be a positive finite number`);
  }
  return dec;
}

export interface ProcessBetInput {
  userId: string;
  amount: string;
  gameType: string;
  currency?: string;
}

export interface ProcessBetResult {
  transactionId: string;
  walletId: string;
  balance: string;
}

export async function processBet(
  input: ProcessBetInput
): Promise<ProcessBetResult> {
  const currency = input.currency ?? 'USD';
  const amount = toAmount(input.amount, 'bet amount');

  await assertWagerAllowed(input.gameType, amount);

  const result = await prisma.$transaction(async (tx) => {
    const account = await tx.user.findUnique({
      where: { id: input.userId },
      select: { frozen: true },
    });
    if (account?.frozen) throw new AccountFrozenError();

    const wallet = await tx.wallet.findUnique({
      where: { userId_currency: { userId: input.userId, currency } },
      select: { id: true },
    });
    if (!wallet) throw new WalletNotFoundError();

    const debited = await tx.wallet.updateMany({
      where: { id: wallet.id, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });

    if (debited.count !== 1) {
      throw new InsufficientFundsError();
    }

    const bet = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.BET,
        amount,
        status: 'COMPLETED',
      },
      select: { id: true },
    });

    const updated = await tx.wallet.findUniqueOrThrow({
      where: { id: wallet.id },
      select: { balance: true },
    });

    return {
      transactionId: bet.id,
      walletId: wallet.id,
      balance: updated.balance.toString(),
    };
  });

  return result;
}

export interface ProcessWinInput {
  userId: string;
  betId: string;
  payoutAmount: string;
  currency?: string;
}

export interface ProcessWinResult {
  transactionId: string;
  balance: string;
}

export async function processWin(
  input: ProcessWinInput
): Promise<ProcessWinResult> {
  const currency = input.currency ?? 'USD';
  const payout = toAmount(input.payoutAmount, 'payout amount');
  const idempotencyKey = `win:${input.betId}`;

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({
      where: { userId_currency: { userId: input.userId, currency } },
      select: { id: true, balance: true },
    });
    if (!wallet) throw new WalletNotFoundError();

    const existing = await tx.transaction.findUnique({
      where: { txHash: idempotencyKey },
      select: { id: true },
    });
    if (existing) {
      return {
        transactionId: existing.id,
        balance: wallet.balance.toString(),
      };
    }

    const win = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.WIN,
        amount: payout,
        status: 'COMPLETED',
        txHash: idempotencyKey,
      },
      select: { id: true },
    });

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: payout } },
      select: { balance: true },
    });

    return { transactionId: win.id, balance: updated.balance.toString() };
  });
}

export interface AwardBonusInput {
  userId: string;
  amount: string;
  currency?: string;
  txHash?: string;
}

export interface AwardBonusResult {
  transactionId: string;
  balance: string;
}

export async function awardBonus(
  input: AwardBonusInput
): Promise<AwardBonusResult> {
  const currency = input.currency ?? 'USD';
  const amount = toAmount(input.amount, 'bonus amount');

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: { userId_currency: { userId: input.userId, currency } },
      update: {},
      create: { userId: input.userId, currency, balance: new D(0) },
      select: { id: true },
    });

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: amount } },
      select: { balance: true },
    });

    const bonusTx = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.DEPOSIT,
        amount,
        status: 'COMPLETED',
        txHash:
          input.txHash ??
          `bonus:${input.userId}:${Date.now()}:${Math.random()
            .toString(36)
            .slice(2, 10)}`,
      },
      select: { id: true },
    });

    return { transactionId: bonusTx.id, balance: updated.balance.toString() };
  });
}

export interface TransferBetweenUsersInput {
  fromUserId: string;
  toUserId: string;
  amount: string;
  currency?: string;
}

export interface TransferBetweenUsersResult {
  fromBalance: string;
  toBalance: string;
}

export async function transferBetweenUsers(
  input: TransferBetweenUsersInput
): Promise<TransferBetweenUsersResult> {
  const currency = input.currency ?? 'USD';
  const amount = toAmount(input.amount, 'transfer amount');

  return prisma.$transaction(async (tx) => {
    const sender = await tx.user.findUnique({
      where: { id: input.fromUserId },
      select: { frozen: true },
    });
    if (sender?.frozen) throw new AccountFrozenError();

    const fromWallet = await tx.wallet.findUnique({
      where: { userId_currency: { userId: input.fromUserId, currency } },
      select: { id: true, balance: true },
    });
    if (!fromWallet) throw new WalletNotFoundError();

    const toWallet = await tx.wallet.upsert({
      where: { userId_currency: { userId: input.toUserId, currency } },
      update: {},
      create: { userId: input.toUserId, currency, balance: new D(0) },
      select: { id: true },
    });

    const debited = await tx.wallet.updateMany({
      where: { id: fromWallet.id, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });
    if (debited.count !== 1) {
      throw new InsufficientFundsError();
    }

    await tx.transaction.create({
      data: {
        walletId: fromWallet.id,
        type: TransactionType.WITHDRAWAL,
        amount,
        status: 'COMPLETED',
        txHash: `tip:${input.fromUserId}:${input.toUserId}:${Date.now()}:${Math.random()
          .toString(36)
          .slice(2, 10)}`,
      },
    });

    const updatedTo = await tx.wallet.update({
      where: { id: toWallet.id },
      data: { balance: { increment: amount } },
      select: { balance: true },
    });

    const updatedFrom = await tx.wallet.findUniqueOrThrow({
      where: { id: fromWallet.id },
      select: { balance: true },
    });

    await tx.transaction.create({
      data: {
        walletId: toWallet.id,
        type: TransactionType.DEPOSIT,
        amount,
        status: 'COMPLETED',
        txHash: `tip:${input.fromUserId}:${input.toUserId}:${Date.now()}:${Math.random()
          .toString(36)
          .slice(2, 10)}`,
      },
    });

    return {
      fromBalance: updatedFrom.balance.toString(),
      toBalance: updatedTo.balance.toString(),
    };
  });
}

export interface SettleAffiliateRewardInput {
  gameType: string;
  userId: string;
  betId: string;
  stake: string;
  payout?: string;
  currency?: string;
}

export interface AffiliateRewardResult {
  transactionId: string;
  referrerId: string;
  amount: string;
  affiliateBalance: string;
  replayed: boolean;
}

function affiliateEdge(gameType: string): Prisma.Decimal {
  if (gameType === 'ROULETTE') return new D(1).dividedBy(37);
  const edge = (HOUSE_EDGE as Record<string, number>)[gameType];
  return new D(typeof edge === 'number' && edge > 0 ? edge : 0);
}

export async function settleAffiliateReward(
  input: SettleAffiliateRewardInput
): Promise<AffiliateRewardResult | null> {
  const currency = input.currency ?? 'USD';
  const stake = toAmount(input.stake, 'stake');

  const netLoss = stake.mul(affiliateEdge(input.gameType));
  if (netLoss.lessThanOrEqualTo(0)) return null;

  const idempotencyKey = `affiliate:${input.betId}`;

  const attempt = () => prisma.$transaction(async (tx) => {
    const player = await tx.user.findUnique({
      where: { id: input.userId },
      select: { referredById: true },
    });
    const referrerId = player?.referredById;
    if (!referrerId) return null;

    if (referrerId === input.userId) return null;

    const existing = await tx.transaction.findUnique({
      where: { txHash: idempotencyKey },
      select: {
        id: true,
        amount: true,
        wallet: { select: { userId: true, affiliateBalance: true } },
      },
    });
    if (existing) {
      return {
        transactionId: existing.id,
        referrerId: existing.wallet.userId,
        amount: existing.amount.toFixed(8),
        affiliateBalance: existing.wallet.affiliateBalance.toString(),
        replayed: true,
      };
    }

    const referrer = await tx.user.findUnique({
      where: { id: referrerId },
      select: { revSharePercentage: true },
    });
    if (!referrer) return null;

    const pct = referrer.revSharePercentage;
    if (pct.lessThanOrEqualTo(0)) return null;

    const reward = netLoss
      .mul(pct)
      .dividedBy(100)
      .toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
    if (reward.lessThanOrEqualTo(0)) return null;

    const wallet = await tx.wallet.upsert({
      where: { userId_currency: { userId: referrerId, currency } },
      update: {},
      create: { userId: referrerId, currency, balance: new D(0) },
      select: { id: true },
    });

    const credited = await tx.wallet.update({
      where: { id: wallet.id },
      data: { affiliateBalance: { increment: reward } },
      select: { affiliateBalance: true },
    });

    const record = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.AFFILIATE_REWARD,
        amount: reward,
        status: 'COMPLETED',
        txHash: idempotencyKey,
      },
      select: { id: true },
    });

    return {
      transactionId: record.id,
      referrerId,
      amount: reward.toFixed(8),
      affiliateBalance: credited.affiliateBalance.toString(),
      replayed: false,
    };
  });

  try {
    return await attempt();
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return attempt();
    }
    throw err;
  }
}

export class NothingToClaimError extends Error {
  constructor() {
    super('No affiliate earnings to claim');
    this.name = 'NothingToClaimError';
  }
}

export interface ClaimAffiliateResult {
  transactionId: string;
  claimed: string;
  balance: string;
  affiliateBalance: string;
}

export async function claimAffiliateEarnings(input: {
  userId: string;
  currency?: string;
}): Promise<ClaimAffiliateResult> {
  const currency = input.currency ?? 'USD';

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({
      where: { userId_currency: { userId: input.userId, currency } },
      select: { id: true, affiliateBalance: true },
    });
    if (!wallet) throw new WalletNotFoundError();

    const amount = wallet.affiliateBalance;
    if (amount.lessThanOrEqualTo(0)) throw new NothingToClaimError();

    const swept = await tx.wallet.updateMany({
      where: { id: wallet.id, affiliateBalance: { gte: amount } },
      data: {
        affiliateBalance: { decrement: amount },
        balance: { increment: amount },
      },
    });
    if (swept.count !== 1) throw new NothingToClaimError();

    const record = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.AFFILIATE_CLAIM,
        amount,
        status: 'COMPLETED',
      },
      select: { id: true },
    });

    const updated = await tx.wallet.findUniqueOrThrow({
      where: { id: wallet.id },
      select: { balance: true, affiliateBalance: true },
    });

    return {
      transactionId: record.id,
      claimed: amount.toFixed(8),
      balance: updated.balance.toString(),
      affiliateBalance: updated.affiliateBalance.toString(),
    };
  });
}

export async function getBalance(
  userId: string,
  currency = 'USD'
): Promise<string> {
  const wallet = await prisma.wallet.findUnique({
    where: { userId_currency: { userId, currency } },
    select: { balance: true },
  });
  if (!wallet) throw new WalletNotFoundError();
  return wallet.balance.toString();
}

export interface AdjustBalanceInput {
  userId: string;
  amount: string;
  direction: 'CREDIT' | 'DEBIT';
  currency?: string;
  idempotencyKey: string;
  audit: { adminId: string; reason: string };
}

export interface AdjustBalanceResult {
  transactionId: string;
  balance: string;
  replayed: boolean;
}

export async function adjustBalance(
  input: AdjustBalanceInput
): Promise<AdjustBalanceResult> {
  const currency = input.currency ?? 'USD';
  const amount = toAmount(input.amount, 'adjustment amount');
  const idempotencyKey = `adj:${input.idempotencyKey}`;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.transaction.findUnique({
      where: { txHash: idempotencyKey },
      select: { id: true, wallet: { select: { balance: true } } },
    });
    if (existing) {
      return {
        transactionId: existing.id,
        balance: existing.wallet.balance.toString(),
        replayed: true,
      };
    }

    const wallet = await tx.wallet.upsert({
      where: { userId_currency: { userId: input.userId, currency } },
      update: {},
      create: { userId: input.userId, currency, balance: new D(0) },
      select: { id: true },
    });

    if (input.direction === 'DEBIT') {
      const debited = await tx.wallet.updateMany({
        where: { id: wallet.id, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      });
      if (debited.count !== 1) throw new InsufficientFundsError();
    } else {
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: amount } },
      });
    }

    const record = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type:
          input.direction === 'CREDIT'
            ? TransactionType.DEPOSIT
            : TransactionType.WITHDRAWAL,
        amount,
        status: 'COMPLETED',
        txHash: idempotencyKey,
      },
      select: { id: true },
    });

    const updated = await tx.wallet.findUniqueOrThrow({
      where: { id: wallet.id },
      select: { balance: true },
    });

    await auditWithin(tx, {
      adminId: input.audit.adminId,
      action: 'BALANCE_ADJUSTED',
      targetUserId: input.userId,
      details: {
        amount: input.amount,
        direction: input.direction,
        reason: input.audit.reason,
        transactionId: record.id,
        balanceAfter: updated.balance.toString(),
      },
    });

    return {
      transactionId: record.id,
      balance: updated.balance.toString(),
      replayed: false,
    };
  });
}

export class WithdrawalStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WithdrawalStateError';
  }
}

export async function requestWithdrawal(input: {
  userId: string;
  amount: string;
  currency?: string;
}): Promise<{ transactionId: string; balance: string }> {
  const currency = input.currency ?? 'USD';
  const amount = toAmount(input.amount, 'withdrawal amount');

  return prisma.$transaction(async (tx) => {
    const account = await tx.user.findUnique({
      where: { id: input.userId },
      select: { frozen: true },
    });
    if (account?.frozen) throw new AccountFrozenError();

    const wallet = await tx.wallet.findUnique({
      where: { userId_currency: { userId: input.userId, currency } },
      select: { id: true },
    });
    if (!wallet) throw new WalletNotFoundError();

    const debited = await tx.wallet.updateMany({
      where: { id: wallet.id, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });
    if (debited.count !== 1) throw new InsufficientFundsError();

    const record = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: TransactionType.WITHDRAWAL,
        amount,
        status: 'PENDING',
      },
      select: { id: true },
    });

    const updated = await tx.wallet.findUniqueOrThrow({
      where: { id: wallet.id },
      select: { balance: true },
    });

    return { transactionId: record.id, balance: updated.balance.toString() };
  });
}

export async function approveWithdrawal(input: {
  transactionId: string;
  auditWithin: (
    tx: Prisma.TransactionClient,
    details: Record<string, unknown>
  ) => Promise<unknown>;
}): Promise<{ transactionId: string; status: 'COMPLETED' }> {
  return prisma.$transaction(async (tx) => {
    const settled = await tx.transaction.updateMany({
      where: {
        id: input.transactionId,
        type: TransactionType.WITHDRAWAL,
        status: 'PENDING',
      },
      data: { status: 'COMPLETED' },
    });
    if (settled.count !== 1) {
      throw new WithdrawalStateError('withdrawal is not pending');
    }

    const row = await tx.transaction.findUniqueOrThrow({
      where: { id: input.transactionId },
      select: { amount: true, wallet: { select: { userId: true } } },
    });

    await input.auditWithin(tx, {
      transactionId: input.transactionId,
      amount: row.amount.toFixed(8),
      targetUserId: row.wallet.userId,
      outcome: 'APPROVED',
    });

    return { transactionId: input.transactionId, status: 'COMPLETED' as const };
  });
}

export async function rejectWithdrawal(input: {
  transactionId: string;
  auditWithin: (
    tx: Prisma.TransactionClient,
    details: Record<string, unknown>
  ) => Promise<unknown>;
}): Promise<{ transactionId: string; status: 'FAILED'; refunded: string; balance: string }> {
  return prisma.$transaction(async (tx) => {
    const rejected = await tx.transaction.updateMany({
      where: {
        id: input.transactionId,
        type: TransactionType.WITHDRAWAL,
        status: 'PENDING',
      },
      data: { status: 'FAILED' },
    });
    if (rejected.count !== 1) {
      throw new WithdrawalStateError('withdrawal is not pending');
    }

    const row = await tx.transaction.findUniqueOrThrow({
      where: { id: input.transactionId },
      select: { amount: true, walletId: true, wallet: { select: { userId: true } } },
    });

    const wallet = await tx.wallet.update({
      where: { id: row.walletId },
      data: { balance: { increment: row.amount } },
      select: { balance: true },
    });

    await tx.transaction.create({
      data: {
        walletId: row.walletId,
        type: TransactionType.DEPOSIT,
        amount: row.amount,
        status: 'COMPLETED',
        txHash: `refund:${input.transactionId}`,
      },
    });

    await input.auditWithin(tx, {
      transactionId: input.transactionId,
      amount: row.amount.toFixed(8),
      targetUserId: row.wallet.userId,
      outcome: 'REJECTED_AND_REFUNDED',
      balanceAfter: wallet.balance.toString(),
    });

    return {
      transactionId: input.transactionId,
      status: 'FAILED' as const,
      refunded: row.amount.toFixed(8),
      balance: wallet.balance.toString(),
    };
  });
}
