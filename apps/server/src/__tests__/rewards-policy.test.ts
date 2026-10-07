import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Prisma, Role } from '@prisma/client';

import { buildApp } from '../index';
import { prisma } from '../config/prisma';
import { settleAffiliateReward } from '../services/ledger.service';
import { VIP_TIERS, tierFor } from '../services/bonus.service';
import { BONUS_CAP, bonusFor, wageringRemaining } from '../services/depositBonus.service';
import {
  BonusWageringError,
  WithdrawalBelowMinimumError,
  createWithdrawal,
} from '../services/payment.service';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function makeUser(referredById?: string) {
  const user = await prisma.user.create({
    data: {
      email: `policy-${Math.random().toString(16).slice(2)}@test.local`,
      passwordHash: 'x',
      role: Role.USER,
      referredById,
      wallets: { create: { currency: 'USD', balance: new Prisma.Decimal('100') } },
    },
    select: { id: true, revSharePercentage: true },
  });
  return user;
}

describe('referral commission', () => {
  it('defaults new accounts to 10%', async () => {
    const u = await makeUser();
    expect(u.revSharePercentage.toString()).toBe('10');
  });

  it('pays a share of the house edge — even on a bet the player won', async () => {
    const referrer = await makeUser();
    const player = await makeUser(referrer.id);

    const won = await settleAffiliateReward({
      gameType: 'DICE',
      userId: player.id,
      betId: `bet-${Math.random()}`,
      stake: '100',
      payout: '198',
    });
    expect(won?.amount).toBe('0.25000000');

    const lost = await settleAffiliateReward({
      gameType: 'DICE',
      userId: player.id,
      betId: `bet-${Math.random()}`,
      stake: '100',
      payout: '0',
    });
    expect(lost?.amount).toBe('0.25000000');
  });

  it('uses 1/37 for roulette, whose edge is structural', async () => {
    const referrer = await makeUser();
    const player = await makeUser(referrer.id);
    const r = await settleAffiliateReward({
      gameType: 'ROULETTE',
      userId: player.id,
      betId: `bet-${Math.random()}`,
      stake: '37',
    });
    expect(r?.amount).toBe('0.10000000');
  });
});

describe('free money', () => {
  it('has no endpoints left that pay out free rewards', async () => {
    for (const url of [
      '/api/rewards/wheel/spin',
      '/api/rewards/tasks/claim',
      '/api/rewards/promocode',
      '/api/raffles/claim',
      '/api/bonus/spin',
      '/api/vip/daily-wheel',
    ]) {
      const res = await app.inject({ method: 'POST', url, payload: {} });
      expect(res.statusCode, url).toBe(404);
    }
  });
});

describe('VIP ladder', () => {
  it('tops out at $50,000, each step harder than the last, and pays at most 5%', () => {
    expect(tierFor(new Prisma.Decimal(2_499)).name).toBe('Unranked');
    expect(tierFor(new Prisma.Decimal(2_500)).name).toBe('Bronze');
    expect(tierFor(new Prisma.Decimal(50_000)).name).toBe('Diamond');
    expect(Number(VIP_TIERS[VIP_TIERS.length - 1].threshold)).toBe(50_000);
    const gaps = VIP_TIERS.slice(1).map((t, i) => Number(t.threshold) - Number(VIP_TIERS[i].threshold));
    for (let i = 1; i < gaps.length; i += 1) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
    expect(Math.max(...VIP_TIERS.map((t) => t.rakeback))).toBe(0.05);
  });
});

describe('deposit bonuses', () => {
  it('pays 7%, 5% and 3% on the first three deposits, capped, and nothing after', () => {
    const d = (n: string) => new Prisma.Decimal(n);
    expect(bonusFor(0, d('100'))?.toFixed(2)).toBe('7.00');
    expect(bonusFor(1, d('100'))?.toFixed(2)).toBe('5.00');
    expect(bonusFor(2, d('100'))?.toFixed(2)).toBe('3.00');
    expect(bonusFor(3, d('100'))).toBeNull();
    expect(bonusFor(0, d('100000'))?.toFixed(2)).toBe(new Prisma.Decimal(BONUS_CAP).toFixed(2));
  });

  it('locks withdrawals until 20× the latest bonus has been wagered', async () => {
    const u = await makeUser();
    const wallet = await prisma.wallet.findFirstOrThrow({ where: { userId: u.id } });
    await prisma.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'DEPOSIT_BONUS',
        amount: new Prisma.Decimal('7'),
        status: 'COMPLETED',
        txHash: `deposit-bonus:test-${Math.random()}`,
      },
    });
    expect((await wageringRemaining(u.id)).toFixed(2)).toBe('140.00');
    await expect(
      createWithdrawal({ userId: u.id, amount: '20', currency: 'USDT', address: 'T'.padEnd(34, 'x') })
    ).rejects.toBeInstanceOf(BonusWageringError);
    const after = await prisma.wallet.findFirstOrThrow({ where: { userId: u.id } });
    expect(after.balance.toString()).toBe('100');
  });
});

describe('withdrawal minimum', () => {
  it('refuses anything under $10, whatever the coin', async () => {
    const u = await makeUser();
    for (const currency of ['USDT', 'BTC', 'ETH'] as const) {
      await expect(
        createWithdrawal({ userId: u.id, amount: '9.99', currency, address: 'x'.repeat(34) })
      ).rejects.toBeInstanceOf(WithdrawalBelowMinimumError);
    }
  });
});
