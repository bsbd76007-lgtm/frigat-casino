import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../config/prisma';
import { getBalance } from '../services/ledger.service';
import * as mines from '../engines/mines.engine';
import { connect as open, seedPlayer, startServer, type Frame } from './helpers/socket';

let app: FastifyInstance;
let port: number;

beforeAll(async () => {
  ({ app, port } = await startServer());
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const connect = (userId: string) => open(port, userId, 'MINES');

const isType = (type: string) => (f: Frame) => f.type === type && f.data.gameType === 'MINES';

async function layoutOf(accepted: Frame, minesCount: number) {
  const pair = await prisma.provableSeed.findFirstOrThrow({
    where: { hashedServerSeed: String(accepted.data.hashedServerSeed) },
  });
  return mines.generateLayout(minesCount, {
    serverSeed: pair.serverSeed,
    clientSeed: String(accepted.data.clientSeed),
    nonce: Number(accepted.data.nonce),
    hashedServerSeed: pair.hashedServerSeed,
  });
}

describe('mines over the socket', () => {
  it('resumes a round after reconnecting and cashes it out', async () => {
    const userId = await seedPlayer('100');
    const first = await connect(userId);

    first.send('BET', { amount: '10.00', currency: 'USD', params: { minesCount: 5 } });
    const accepted = await first.next(isType('BET_ACCEPTED'));
    const layout = await layoutOf(accepted, 5);
    const safe = Array.from({ length: 25 }, (_, i) => i).filter(
      (tile) => !layout.minePositions.includes(tile)
    );

    first.send('REVEAL_TILE', { tile: safe[0] });
    const update = await first.next(isType('STATE_UPDATE'));
    expect(update.data.revealedTile).toBe(safe[0]);
    first.ws.close();

    const second = await connect(userId);
    const resumed = await second.next(isType('BET_ACCEPTED'));
    expect(resumed.data.resumed).toBe(true);
    expect(resumed.data.revealed).toEqual([safe[0]]);
    expect(resumed.data.minesCount).toBe(5);
    expect(resumed.data.potentialPayout).toBe(update.data.potentialPayout);

    second.send('CASHOUT');
    const result = await second.next(isType('GAME_RESULT'));
    expect(result.data.win).toBe(true);
    expect(result.data.payout).toBe(update.data.potentialPayout);

    const balance = await getBalance(userId, 'USD');
    expect(Number(balance)).toBeCloseTo(90 + Number(update.data.potentialPayout), 6);

    second.send('BET', { amount: '1.00', currency: 'USD', params: { minesCount: 5 } });
    const again = await second.next(isType('BET_ACCEPTED'));
    expect(again.data.resumed).toBeUndefined();
    second.ws.close();
  });

  it('tags errors with the game that caused them', async () => {
    const userId = await seedPlayer('100');
    const p = await connect(userId);
    p.send('REVEAL_TILE', { tile: 3 });
    const error = await p.next((f) => f.type === 'ERROR');
    expect(error.data.code).toBe('NO_ACTIVE_GAME');
    expect(error.data.gameType).toBe('MINES');
    p.ws.close();
  });

  it('answers RESUME_NONE when there is no round to resume', async () => {
    const userId = await seedPlayer('100');
    const p = await connect(userId);
    p.send('RESUME');
    const none = await p.next((f) => f.type === 'RESUME_NONE');
    expect(none.data.gameType).toBe('MINES');
    p.ws.close();
  });

  it('settles a bust at zero and frees the player for a new round', async () => {
    const userId = await seedPlayer('100');
    const p = await connect(userId);

    p.send('BET', { amount: '10.00', currency: 'USD', params: { minesCount: 5 } });
    const accepted = await p.next(isType('BET_ACCEPTED'));
    const layout = await layoutOf(accepted, 5);

    p.send('REVEAL_TILE', { tile: layout.minePositions[0] });
    const result = await p.next(isType('GAME_RESULT'));
    expect(result.data.bust).toBe(true);
    expect(result.data.payout).toBe('0');
    expect(Number(await getBalance(userId, 'USD'))).toBeCloseTo(90, 6);

    p.send('BET', { amount: '1.00', currency: 'USD', params: { minesCount: 5 } });
    await p.next(isType('BET_ACCEPTED'));
    p.ws.close();
  });
});
