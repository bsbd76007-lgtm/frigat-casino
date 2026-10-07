import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { Prisma, Role } from '@prisma/client';
import { randomUUID } from 'crypto';

import { prisma } from '../config/prisma';
import { processBet, processWin, getBalance } from '../services/ledger.service';
import { CrashRoundManager, type CrashRound } from '../websocket/crashRound.manager';
import { elapsedForMultiplier, multiplierAtElapsed } from './crash.engine';
import type { SeedContext } from '../types/engine.types';

const seed = (): SeedContext => ({
  serverSeed: 'a'.repeat(64),
  clientSeed: 'player',
  nonce: 0,
  hashedServerSeed: 'b'.repeat(64),
});

async function seedPlayer(balance: string) {
  const user = await prisma.user.create({
    data: {
      email: `crash-${randomUUID()}@test.local`,
      passwordHash: 'x',
      role: Role.USER,
      wallets: { create: { currency: 'USD', balance: new Prisma.Decimal(balance) } },
    },
    select: { id: true },
  });
  return user.id;
}

async function cashOut(manager: CrashRoundManager, userId: string, betId: string) {
  const multiplier = manager.liveMultiplier(userId);
  const round = manager.end(userId);
  if (!round) return { paid: false, multiplier: 0 };

  await processWin({
    userId,
    betId,
    payoutAmount: (10 * Math.min(multiplier, round.crashPoint)).toFixed(8),
  });
  return { paid: true, multiplier };
}

let busts: CrashRound[];
let ticks: CrashRound[];
let manager: CrashRoundManager;

beforeEach(() => {
  vi.useFakeTimers();
  busts = [];
  ticks = [];
  manager = new CrashRoundManager(
    (r) => ticks.push({ ...r }),
    async (r) => {
      busts.push({ ...r });
    }
  );
});

afterEach(() => {
  manager.stopAll();
  vi.useRealTimers();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('crash cash-out vs bust', () => {
  it('pays a cash-out taken before the crash point', async () => {
    const userId = await seedPlayer('100');
    const bet = await processBet({ userId, amount: '10', gameType: 'CRASH' });

    manager.start(userId, seed(), 2.0);
    vi.advanceTimersByTime(elapsedForMultiplier(1.5));

    const result = await cashOut(manager, userId, bet.transactionId);
    expect(result.paid).toBe(true);
    expect(busts).toHaveLength(0);
    expect(Number(await getBalance(userId))).toBeGreaterThan(90);
  });

  it('refuses a cash-out arriving at the crash point — bust, zero payout', async () => {
    const userId = await seedPlayer('100');
    const bet = await processBet({ userId, amount: '10', gameType: 'CRASH' });
    expect(await getBalance(userId)).toBe('90');

    manager.start(userId, seed(), 1.5);

    vi.advanceTimersByTime(elapsedForMultiplier(1.5) + 200);
    expect(busts).toHaveLength(1);

    const result = await cashOut(manager, userId, bet.transactionId);

    expect(result.paid).toBe(false);
    expect(await getBalance(userId)).toBe('90');
    expect(
      await prisma.transaction.count({ where: { wallet: { userId }, type: 'WIN' } })
    ).toBe(0);
  });

  it('refuses every cash-out after a bust, however many arrive', async () => {
    const userId = await seedPlayer('100');
    const bet = await processBet({ userId, amount: '10', gameType: 'CRASH' });

    manager.start(userId, seed(), 1.5);
    vi.advanceTimersByTime(elapsedForMultiplier(1.5) + 200);

    for (let i = 0; i < 5; i += 1) {
      expect((await cashOut(manager, userId, bet.transactionId)).paid).toBe(false);
    }
    expect(await getBalance(userId)).toBe('90');
  });

  it('busts once and stops ticking', async () => {
    const userId = await seedPlayer('100');
    manager.start(userId, seed(), 1.5);

    vi.advanceTimersByTime(elapsedForMultiplier(1.5) + 5_000);

    expect(busts).toHaveLength(1);
    expect(manager.isRunning(userId)).toBe(false);
    expect(manager.activeRoundCount()).toBe(0);

    const after = ticks.length;
    vi.advanceTimersByTime(5_000);
    expect(ticks.length).toBe(after);
  });

  it('a cash-out stops the curve, so no bust can follow it', async () => {
    const userId = await seedPlayer('100');
    const bet = await processBet({ userId, amount: '10', gameType: 'CRASH' });

    manager.start(userId, seed(), 2.0);
    vi.advanceTimersByTime(elapsedForMultiplier(1.2));
    expect((await cashOut(manager, userId, bet.transactionId)).paid).toBe(true);

    vi.advanceTimersByTime(elapsedForMultiplier(3.0));
    expect(busts).toHaveLength(0);
  });

  it('pays a cash-out at most once', async () => {
    const userId = await seedPlayer('100');
    const bet = await processBet({ userId, amount: '10', gameType: 'CRASH' });

    manager.start(userId, seed(), 3.0);
    vi.advanceTimersByTime(elapsedForMultiplier(1.5));

    const first = await cashOut(manager, userId, bet.transactionId);
    const second = await cashOut(manager, userId, bet.transactionId);

    expect(first.paid).toBe(true);
    expect(second.paid).toBe(false);
    expect(
      await prisma.transaction.count({ where: { wallet: { userId }, type: 'WIN' } })
    ).toBe(1);
  });

  it('a second start never orphans the first round', async () => {
    const userId = await seedPlayer('100');
    manager.start(userId, seed(), 5.0);
    manager.start(userId, seed(), 5.0);

    expect(manager.activeRoundCount()).toBe(1);
    vi.advanceTimersByTime(elapsedForMultiplier(5.0) + 500);
    expect(busts).toHaveLength(1);
  });
});

describe('crash curve', () => {
  it('starts at 1.00 and never dips below it', () => {
    expect(multiplierAtElapsed(0)).toBe(1);
    expect(multiplierAtElapsed(-5_000)).toBe(1);
  });

  it('round-trips through elapsedForMultiplier', () => {
    for (const target of [1.2, 1.5, 2, 5, 10]) {
      const ms = elapsedForMultiplier(target);
      expect(multiplierAtElapsed(ms)).toBeGreaterThanOrEqual(target - 0.01);
    }
  });

  it('is monotonic in elapsed time', () => {
    let previous = 0;
    for (let ms = 0; ms <= 30_000; ms += 500) {
      const m = multiplierAtElapsed(ms);
      expect(m).toBeGreaterThanOrEqual(previous);
      previous = m;
    }
  });
});
