/**
 * VIP: tiers, rakeback status and rakeback claims. The daily wheel and the
 * other free-money rewards were removed along with the Free Money page.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { awardBonus } from './ledger.service';

const D = Prisma.Decimal;

/**
 * VIP ladder: lifetime wagered to reach each tier, and the share of net losses
 * paid back as rakeback. Tops out at $50,000, and every step is a bigger climb
 * than the last ($2.5k, then +5k, +10k, +15k, +17.5k), so each level is harder
 * to reach than the one before. At most 5% back.
 */
export const VIP_TIERS = [
  { name: 'Unranked', threshold: '0', rakeback: 0 },
  { name: 'Bronze', threshold: '2500', rakeback: 0.01 },
  { name: 'Silver', threshold: '7500', rakeback: 0.02 },
  { name: 'Gold', threshold: '17500', rakeback: 0.03 },
  { name: 'Platinum', threshold: '32500', rakeback: 0.04 },
  { name: 'Diamond', threshold: '50000', rakeback: 0.05 },
] as const;

/** Rakeback is only paid out once at least this much has built up. */
export const RAKEBACK_MIN_CLAIM = '1';

export type TierName = (typeof VIP_TIERS)[number]['name'];

export class NothingToClaimError extends Error {
  constructor() {
    super('No rakeback available to claim');
    this.name = 'NothingToClaimError';
  }
}

export function tierFor(wagered: Prisma.Decimal): (typeof VIP_TIERS)[number] {
  for (let i = VIP_TIERS.length - 1; i >= 0; i -= 1) {
    if (wagered.greaterThanOrEqualTo(new D(VIP_TIERS[i].threshold))) {
      return VIP_TIERS[i];
    }
  }
  return VIP_TIERS[0];
}

export function nextTierFor(
  wagered: Prisma.Decimal
): (typeof VIP_TIERS)[number] | null {
  for (const tier of VIP_TIERS) {
    if (wagered.lessThan(new D(tier.threshold))) return tier;
  }
  return null;
}

export interface VipStatus {
  tier: TierName;
  rakebackRate: number;
  totalWagered: string;
  nextTier: { name: TierName; threshold: string; remaining: string } | null;
  progress: number;
  claimable: string;
  balance: string;
  currency: string;
}

export async function getVipStatus(input: {
  userId: string;
  currency?: string;
}): Promise<VipStatus> {
  const currency = input.currency ?? 'USD';

  const [sessions, wallet, claimed] = await Promise.all([
    prisma.gameSession.aggregate({
      _sum: { betAmount: true, payout: true },
      where: { userId: input.userId },
    }),
    prisma.wallet.findUnique({
      where: { userId_currency: { userId: input.userId, currency } },
      select: { balance: true },
    }),
    prisma.rakebackClaim.aggregate({
      _sum: { amount: true },
      where: { userId: input.userId },
    }),
  ]);

  const wagered = sessions._sum.betAmount ?? new D(0);
  const returned = sessions._sum.payout ?? new D(0);
  const alreadyClaimed = claimed._sum.amount ?? new D(0);

  const tier = tierFor(wagered);
  const next = nextTierFor(wagered);

  const edge = wagered.minus(returned);
  const entitlement = edge.lessThanOrEqualTo(0)
    ? new D(0)
    : edge.mul(tier.rakeback);
  const claimable = Prisma.Decimal.max(
    new D(0),
    entitlement.minus(alreadyClaimed)
  ).toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);

  let progress = 1;
  if (next) {
    const floor = new D(tier.threshold);
    const ceiling = new D(next.threshold);
    const span = ceiling.minus(floor);
    progress = span.lessThanOrEqualTo(0)
      ? 1
      : Math.min(
          1,
          Math.max(0, wagered.minus(floor).div(span).toNumber())
        );
  }

  return {
    tier: tier.name,
    rakebackRate: tier.rakeback,
    totalWagered: wagered.toFixed(8),
    nextTier: next
      ? {
          name: next.name,
          threshold: next.threshold,
          remaining: new D(next.threshold).minus(wagered).toFixed(8),
        }
      : null,
    progress,
    claimable: claimable.toFixed(8),
    balance: wallet?.balance.toString() ?? '0',
    currency,
  };
}

export async function claimRakeback(input: {
  userId: string;
  currency?: string;
}): Promise<{ claimed: string; balance: string; currency: string }> {
  const currency = input.currency ?? 'USD';

  /**
   * The entitlement is derived (lifetime rakeback earned minus what has already
   * been claimed), so there is no period or flag to
   * hang a conditional write on, and RakebackClaim carries no unique key that
   * would reject a duplicate.
   *
   * That left a plain check-then-act: read `claimable`, then insert. Five
   * concurrent requests all read the same 1000.00 before any insert committed,
   * all five inserted, and all five credited — 5000.00 paid against a 1000.00
   * entitlement, repeatable on every subsequent accrual.
   *
   * A row lock on the user is the serialisation point. The second caller blocks
   * at SELECT ... FOR UPDATE until the first transaction commits, and by then
   * its own getVipStatus sees the committed claim and reads a claimable of
   * zero. Locking the user row rather than a rakeback row is deliberate: the
   * very first claim has no prior row to lock.
   */
  const claim = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;

    const status = await getVipStatus({ userId: input.userId, currency });
    const amount = new D(status.claimable);
    if (amount.lessThan(RAKEBACK_MIN_CLAIM)) throw new NothingToClaimError();

    const row = await tx.rakebackClaim.create({
      data: { userId: input.userId, amount, currency },
      select: { id: true },
    });
    return { id: row.id, amount };
  });

  // Keyed on the claim row, so the credit is idempotent. Previously the claim
  // committed and then the award ran unguarded: if awardBonus threw, the claim
  // row survived, permanently reducing the entitlement with nothing credited.
  // With a stable key this call can simply be retried.
  const bonus = await awardBonus({
    userId: input.userId,
    amount: claim.amount.toFixed(8),
    currency,
    txHash: `rakeback:${claim.id}`,
  });

  return {
    claimed: claim.amount.toFixed(8),
    balance: bonus.balance,
    currency,
  };
}
