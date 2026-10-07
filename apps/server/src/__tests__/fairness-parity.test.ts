import { describe, it, expect } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';

import { HOUSE_EDGE } from '../config/game.config';
import { LIMBO, CHICKEN, type ChickenMode } from '@frigat/shared';
import * as crash from '../engines/crash.engine';
import * as limbo from '../engines/limbo.engine';
import * as dice from '../engines/dice.engine';
import * as coinflip from '../engines/coinflip.engine';
import * as roulette from '../engines/roulette.engine';
import * as mines from '../engines/mines.engine';
import * as chicken from '../engines/chicken.engine';
import * as avia from '../engines/avia.engine';

import {
  verifyCrash,
  verifyLimbo,
  verifyDice,
  verifyCoinflip,
  verifyRoulette,
  verifyMines,
  verifyChicken,
  chickenMultiplierAt,
  chickenMaxLanes,
  chickenMinCashoutLane,
  verifyAvia,
  aviaLandingChance,
  aviaSafeLandingMaxStake,
} from '../../../web/lib/verify';

const VERIFY_PATH = 'apps/web/lib/verify.ts';

function seedContext(nonce: number) {
  const serverSeed = randomBytes(32).toString('hex');
  const clientSeed = randomBytes(8).toString('hex');
  return {
    serverSeed,
    clientSeed,
    nonce,
    hashedServerSeed: createHash('sha256').update(serverSeed).digest('hex'),
  };
}

const SAMPLES = 200;
const seeds = Array.from({ length: SAMPLES }, (_, i) => seedContext(i + 1));

describe('fairness parity: server engines ↔ browser verifier', () => {
  it(`the edge constants duplicated into ${VERIFY_PATH} match HOUSE_EDGE`, async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await fs.readFile(
      path.resolve(__dirname, '../../../web/lib/verify.ts'),
      'utf8'
    );

    for (const game of ['CRASH', 'LIMBO', 'CHICKEN', 'AVIA'] as const) {
      const m = new RegExp(`${game}:\\s*([0-9.]+)`).exec(src);
      expect(m, `${VERIFY_PATH} no longer declares EDGE.${game}`).not.toBeNull();
      expect(
        Number(m![1]),
        `EDGE.${game} in ${VERIFY_PATH} is ${m![1]} but HOUSE_EDGE.${game} is ` +
          `${HOUSE_EDGE[game]} — a player verifying a ${game} round would ` +
          `compute a different multiplier than the server paid. Update both.`
      ).toBe(HOUSE_EDGE[game]);
    }
  });

  it('crash points agree', async () => {
    for (const s of seeds) {
      const got = await verifyCrash(s.serverSeed, s.clientSeed, s.nonce);
      expect(got, `nonce ${s.nonce}`).toBe(crash.computeCrashPoint(s));
    }
  });

  it('limbo draws agree', async () => {
    for (const s of seeds) {
      const got = await verifyLimbo(s.serverSeed, s.clientSeed, s.nonce);
      const server = limbo.play({ targetMultiplier: LIMBO.minMultiplier }, s);
      expect(got, `nonce ${s.nonce}`).toBe(
        (server.resultData as { achievedMultiplier: number }).achievedMultiplier
      );
    }
  });

  it('dice rolls agree', async () => {
    for (const s of seeds) {
      const got = await verifyDice(s.serverSeed, s.clientSeed, s.nonce);
      const server = dice.play({ target: 50, direction: 'UNDER' }, s);
      expect(Number(got.toFixed(4)), `nonce ${s.nonce}`).toBe(
        (server.resultData as { roll: number }).roll
      );
    }
  });

  it('coinflip sides agree', async () => {
    for (const s of seeds) {
      const got = await verifyCoinflip(s.serverSeed, s.clientSeed, s.nonce);
      const server = coinflip.play({ side: 'HEADS' }, s);
      expect(got, `nonce ${s.nonce}`).toBe(
        (server.resultData as { landed: string }).landed
      );
    }
  });

  it('roulette pockets agree', async () => {
    for (const s of seeds) {
      const got = await verifyRoulette(s.serverSeed, s.clientSeed, s.nonce);
      const server = roulette.spin(
        { bets: [{ position: 'red', amount: '1.00' }] },
        s
      );
      expect(got, `nonce ${s.nonce}`).toBe(
        (server.resultData as { pocket: number }).pocket
      );
    }
  });

  it('mine layouts agree', async () => {
    for (const s of seeds.slice(0, 50)) {
      for (const count of [5, 6, 12, 24]) {
        const got = await verifyMines(s.serverSeed, s.clientSeed, s.nonce, count);
        const server = [...mines.generateLayout(count, s).minePositions].sort(
          (a, b) => a - b
        );
        expect(got, `nonce ${s.nonce}, ${count} mines`).toEqual(server);
      }
    }
  });

  it('chicken roads agree — bust lane, ladder and road length', async () => {
    for (const mode of Object.keys(CHICKEN.modes) as ChickenMode[]) {
      expect(chickenMaxLanes(mode), mode).toBe(chicken.maxLanes(mode));
      expect(chickenMinCashoutLane(mode), mode).toBe(chicken.minCashoutLane(mode));
      for (let lane = 0; lane <= chicken.maxLanes(mode) + 1; lane += 1) {
        expect(chickenMultiplierAt(mode, lane), `${mode} lane ${lane}`).toBe(
          chicken.multiplierAt(mode, lane)
        );
      }
      for (const s of seeds.slice(0, 50)) {
        const got = await verifyChicken(s.serverSeed, s.clientSeed, s.nonce, mode);
        expect(got, `${mode}, nonce ${s.nonce}`).toBe(chicken.bustLane(mode, s));
      }
    }
  });

  it('avia flights agree — every speed, safe or not: landing, events, spot and payout', async () => {
    for (const mode of ['slow', 'fast', 'turbo'] as const) {
      expect(aviaLandingChance(mode), mode).toBe(avia.landingChance(mode));
      expect(aviaSafeLandingMaxStake(mode), mode).toBe(avia.safeLandingMaxStake(mode));
      for (const safe of [false, true]) {
        for (const s of seeds.slice(0, 40)) {
          const got = await verifyAvia(s.serverSeed, s.clientSeed, s.nonce, mode, safe);
          const server = avia.fly(s, mode, safe);
          expect(got, `${mode} safe=${safe} nonce ${s.nonce}`).toEqual({
            landed: server.landed,
            kinds: server.events.map((e) => e.kind),
            multiplier: server.flightMultiplier,
            spot: server.spot,
            payoutMultiplier: server.payoutMultiplier,
          });
        }
      }
    }
  });
});
