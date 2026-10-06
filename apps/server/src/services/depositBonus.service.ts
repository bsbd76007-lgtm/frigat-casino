/**
 * FRIGAT — Deposit bonuses
 *
 * A player's first deposits each earn a percentage on top, credited to the
 * balance in the same transaction that credits the deposit itself (see
 * payment.service). Each bonus is capped, and a withdrawal stays locked until
 * the player has wagered BONUS_WAGER_MULTIPLIER × their latest bonus — without
 * that, deposit-and-withdraw would turn the bonus into free money.
 *
 * Bonus credits are their own ledger type, DEPOSIT_BONUS, so they are never
 * reported as money that entered the platform.
 */

import { Prisma, TransactionType } from '@prisma/client';

import { prisma } from '../config/prisma';

const D = Prisma.Decimal;

/** The ladder: the nth credited deposit earns `rate` of its amount. */
export const DEPOSIT_BONUSES = [
  { deposit: 1, rate: 0.07 },
  { deposit: 2, rate: 0.05 },
  { deposit: 3, rate: 0.03 },
] as const;

/** No single bonus pays more than this, whatever the deposit. */
export const BONUS_CAP = '100';
/** A bonus must be wagered this many times before a withdrawal is allowed. */
export const BONUS_WAGER_MULTIPLIER = 20;

/**
 * The bonus for a deposit, given how many deposits were credited before it.
 * Null when this deposit is past the end of the ladder.
 */
export function bonusFor(priorDeposits: number, amount: Prisma.Decimal): Prisma.Decimal | null {
  const step = DEPOSIT_BONUSES.find((b) => b.deposit === priorDeposits + 1);
  if (!step) return null;
  const bonus = Prisma.Decimal.min(amount.mul(step.rate), new D(BONUS_CAP)).toDecimalPlaces(
    8,
    Prisma.Decimal.ROUND_DOWN
  );
  return bonus.gt(0) ? bonus : null;
}

/** How much more the player must wager before they may withdraw. 0 when clear. */
export async function wageringRemaining(userId: string): Promise<Prisma.Decimal> {
  const latest = await prisma.transaction.findFirst({
    where: { type: TransactionType.DEPOSIT_BONUS, wallet: { userId } },
    orderBy: { createdAt: 'desc' },
    select: { amount: true, createdAt: true },
  });
  if (!latest) return new D(0);

  const required = latest.amount.mul(BONUS_WAGER_MULTIPLIER);
  const wagered = await prisma.gameSession.aggregate({
    _sum: { betAmount: true },
    where: { userId, createdAt: { gte: latest.createdAt } },
  });
  const remaining = required.minus(wagered._sum.betAmount ?? new D(0));
  return remaining.gt(0) ? remaining.toDecimalPlaces(2, Prisma.Decimal.ROUND_UP) : new D(0);
}

export interface BonusStatus {
  ladder: Array<{ deposit: number; rate: number; claimed: boolean; amount: string | null }>;
  cap: string;
  wagerMultiplier: number;
  /** Rate the next deposit earns, or null once the ladder is used up. */
  nextRate: number | null;
  wageringRemaining: string;
}

export async function getBonusStatus(userId: string): Promise<BonusStatus> {
  const [bonuses, remaining] = await Promise.all([
    prisma.transaction.findMany({
      where: { type: TransactionType.DEPOSIT_BONUS, wallet: { userId } },
      orderBy: { createdAt: 'asc' },
      select: { amount: true },
    }),
    wageringRemaining(userId),
  ]);
  const deposits = await prisma.payment.count({
    where: { userId, transactionId: { not: null } },
  });

  return {
    ladder: DEPOSIT_BONUSES.map((step, i) => ({
      deposit: step.deposit,
      rate: step.rate,
      claimed: deposits >= step.deposit,
      amount: bonuses[i]?.amount.toFixed(2) ?? null,
    })),
    cap: BONUS_CAP,
    wagerMultiplier: BONUS_WAGER_MULTIPLIER,
    nextRate: DEPOSIT_BONUSES.find((b) => b.deposit === deposits + 1)?.rate ?? null,
    wageringRemaining: remaining.toFixed(2),
  };
}
