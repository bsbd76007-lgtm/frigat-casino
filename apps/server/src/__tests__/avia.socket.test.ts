import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';

import { prisma } from '../config/prisma';
import { getBalance } from '../services/ledger.service';
import * as avia from '../engines/avia.engine';
import { connect, seedPlayer, startServer, type Frame } from './helpers/socket';

/**
 * Avia Masters, end to end: one BET is one whole flight, settled in the same
 * frame. Every flight is replayed from the seed the server committed to, so the
 * balance after each one is asserted exactly.
 */

let app: FastifyInstance;
let port: number;

beforeAll(async () => {
  ({ app, port } = await startServer());
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const isResult = (f: Frame) => f.type === 'GAME_RESULT' && f.data.gameType === 'AVIA';

describe('avia over the socket', () => {
  it('settles each flight exactly as the seed says — landings pay, ditches do not', async () => {
    const userId = await seedPlayer('1000');
    const p = await connect(port, userId, 'AVIA');
    let expected = new Prisma.Decimal(1000);
    let sawLand = false;
    let sawDitch = false;

    // ~14.6% of slow flights land, so 80 rounds miss a landing about once in
    // 30,000 runs.
    for (let round = 0; round < 80 && !(sawLand && sawDitch); round += 1) {
      p.send('BET', { amount: '5.00', currency: 'USD', params: { mode: 'slow' } });
      const result = await p.next(isResult);

      const session = await prisma.gameSession.findFirstOrThrow({
        where: { userId, gameType: 'AVIA' },
        orderBy: { createdAt: 'desc' },
      });
      const flight = avia.fly({
        serverSeed: session.serverSeed,
        clientSeed: session.clientSeed,
        nonce: session.nonce,
        hashedServerSeed: '',
      }, 'slow');

      // What the client animates is exactly what the seed produces.
      const data = result.data.resultData as { landed: boolean; events: unknown[] };
      expect(data.landed).toBe(flight.landed);
      expect(data.events).toEqual(flight.events);

      const payout = flight.landed
        ? new Prisma.Decimal(5).mul(flight.payoutMultiplier).toDecimalPlaces(8)
        : new Prisma.Decimal(0);
      expected = expected.minus(5).plus(payout);
      expect(new Prisma.Decimal(String(result.data.payout)).equals(payout)).toBe(true);
      expect(await getBalance(userId)).toBe(expected.toString());

      if (flight.landed) sawLand = true;
      else sawDitch = true;
    }

    expect(sawLand && sawDitch).toBe(true);
    p.ws.close();
  });

  it('charges the fee for a safe landing, always lands, and pays off the stake alone', async () => {
    const userId = await seedPlayer('100');
    const p = await connect(port, userId, 'AVIA');
    const stake = '0.40';
    p.send('BET', { amount: stake, currency: 'USD', params: { mode: 'slow', safe: true } });
    const result = await p.next(isResult);

    const session = await prisma.gameSession.findFirstOrThrow({
      where: { userId, gameType: 'AVIA' },
      orderBy: { createdAt: 'desc' },
    });
    const flight = avia.fly(
      { serverSeed: session.serverSeed, clientSeed: session.clientSeed, nonce: session.nonce, hashedServerSeed: '' },
      'slow',
      true
    );
    expect((result.data.resultData as { landed: boolean }).landed).toBe(true);
    // The session records everything paid in, fee included.
    expect(session.betAmount.toString()).toBe('5.4');
    const payout = new Prisma.Decimal(stake).mul(flight.payoutMultiplier).toDecimalPlaces(8);
    expect(new Prisma.Decimal(String(result.data.payout)).equals(payout)).toBe(true);
    expect(await getBalance(userId)).toBe(new Prisma.Decimal(100).minus('5.40').plus(payout).toString());
    p.ws.close();
  });

  it('refuses a safe landing above the stake cap, and takes nothing', async () => {
    const userId = await seedPlayer('100');
    const p = await connect(port, userId, 'AVIA');
    const over = (avia.safeLandingMaxStake('turbo') + 0.01).toFixed(2);
    p.send('BET', { amount: over, currency: 'USD', params: { mode: 'turbo', safe: true } });
    const err = await p.next((f) => f.type === 'ERROR');
    expect(err.data.code).toBe('SAFE_LANDING_LIMIT');
    expect(await getBalance(userId)).toBe('100');
    p.ws.close();
  });

  it('refuses an unknown speed, and takes nothing', async () => {
    const userId = await seedPlayer('100');
    const p = await connect(port, userId, 'AVIA');
    p.send('BET', { amount: '1.00', currency: 'USD', params: { mode: 'warp' } });
    const err = await p.next((f) => f.type === 'ERROR');
    expect(err.data.code).toBe('BAD_REQUEST');
    expect(await getBalance(userId)).toBe('100');
    p.ws.close();
  });

  it('refuses a stake the wallet cannot cover, and takes nothing', async () => {
    const userId = await seedPlayer('2');
    const p = await connect(port, userId, 'AVIA');
    p.send('BET', { amount: '5.00', currency: 'USD', params: {} });
    const err = await p.next((f) => f.type === 'ERROR');
    expect(err.data.code).toBe('INSUFFICIENT_FUNDS');
    expect(await getBalance(userId)).toBe('2');
    p.ws.close();
  });
});
