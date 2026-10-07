import { describe, it, expect } from 'vitest';
import {
  AVIA,
  aviaEventTable,
  aviaExpectedMultiplier,
  aviaExpectedSpot,
  type AviaMode,
} from '@frigat/shared';

import { fly, isAviaMode, landingChance, play, safeLandingMaxStake } from './avia.engine';
import { HOUSE_EDGE } from '../config/game.config';
import type { SeedContext } from '../types/engine.types';

const ctx = (nonce = 0, serverSeed = 'a'.repeat(64)): SeedContext => ({
  serverSeed,
  clientSeed: 'player-seed',
  nonce,
  hashedServerSeed: 'b'.repeat(64),
});

const RTP = 1 - HOUSE_EDGE.AVIA;
const MODES = Object.keys(AVIA.modes) as AviaMode[];

describe('avia — pricing', () => {
  it('prices every mode so P(land) · E[M] · E[spot] is exactly the target RTP', () => {
    for (const mode of MODES) {
      const value = aviaExpectedMultiplier(mode) * aviaExpectedSpot();
      expect(landingChance(mode) * value).toBeCloseTo(RTP, 12);
    }
  });

  it('gets harder with speed, and every mode is harder than the old 17.5%', () => {
    const [slow, fast, turbo] = MODES.map(landingChance);
    expect(MODES).toEqual(['slow', 'fast', 'turbo']);
    expect(slow).toBeLessThan(0.175);
    expect(fast).toBeLessThan(slow);
    expect(turbo).toBeLessThan(fast);
    expect(turbo).toBeGreaterThan(0.05);
  });

  it('puts more bombs in a faster plane', () => {
    const bombShare = (mode: AviaMode) => {
      const table = aviaEventTable(mode);
      const total = table.reduce((s, e) => s + e.weight, 0);
      return table.filter((e) => e.mul < 1).reduce((s, e) => s + e.weight, 0) / total;
    };
    expect(bombShare('fast')).toBeGreaterThan(bombShare('slow'));
    expect(bombShare('turbo')).toBeGreaterThan(bombShare('fast'));
  });

  it('matches E[M] by simulation — the exact formula is not wishful', () => {
    const rounds = 80_000;
    let sum = 0;
    for (let n = 0; n < rounds; n += 1) sum += fly(ctx(n, 'e'.repeat(64)), 'slow').flightMultiplier;
    expect(Math.abs(sum / rounds - aviaExpectedMultiplier('slow'))).toBeLessThan(0.3);
  });

  it('returns the target RTP (Monte Carlo)', () => {
    const rounds = 100_000;
    let returned = 0;
    for (let n = 0; n < rounds; n += 1) {
      returned += play({ mode: 'slow' }, ctx(n, 'f'.repeat(64))).multiplier;
    }
    expect(Math.abs(returned / rounds - RTP)).toBeLessThan(0.1);
  });

  it('lands at the priced rate', () => {
    const rounds = 20_000;
    for (const mode of MODES) {
      let landed = 0;
      for (let n = 0; n < rounds; n += 1) if (fly(ctx(n, '1'.repeat(64)), mode).landed) landed += 1;
      expect(Math.abs(landed / rounds - landingChance(mode))).toBeLessThan(0.015);
    }
  });
});

describe('avia — safe landing', () => {
  it('caps the stake so a guaranteed landing still returns at most the RTP of stake + fee', () => {
    for (const mode of MODES) {
      const cap = safeLandingMaxStake(mode);
      expect(cap).toBeGreaterThan(0);
      const value = aviaExpectedMultiplier(mode) * aviaExpectedSpot();
      expect(cap * value).toBeLessThanOrEqual(RTP * (cap + AVIA.safeLanding.fee) + 1e-9);
      expect((cap + 0.01) * value).toBeGreaterThan(RTP * (cap + 0.01 + AVIA.safeLanding.fee));
    }
  });

  it('always lands, and changes nothing else about the flight', () => {
    for (let n = 0; n < 300; n += 1) {
      const normal = fly(ctx(n), 'fast');
      const safe = fly(ctx(n), 'fast', true);
      expect(safe.landed).toBe(true);
      expect(safe.safe).toBe(true);
      expect(safe.events).toEqual(normal.events);
      if (normal.landed) expect(safe.spot).toBe(normal.spot);
    }
  });

  it('is only honoured when play() is told so explicitly', () => {
    for (const safe of ['true', 1, {}]) {
      const r = play({ mode: 'turbo', safe }, ctx(4));
      expect((r.resultData as { safe: boolean }).safe).toBe(false);
    }
  });
});

describe('avia — flights', () => {
  it('accepts only the configured modes', () => {
    for (const mode of MODES) expect(isAviaMode(mode)).toBe(true);
    for (const bad of ['', 'SLOW', 'toString', '__proto__', 0, null, undefined]) {
      expect(isAviaMode(bad)).toBe(false);
    }
  });

  it('is deterministic for a seed and varies across nonces', () => {
    expect(fly(ctx(3), 'turbo')).toEqual(fly(ctx(3), 'turbo'));
    const lengths = new Set(Array.from({ length: 60 }, (_, n) => fly(ctx(n), 'slow').events.length));
    expect(lengths.size).toBeGreaterThan(3);
  });

  it('flies a length within the mode bounds, with every event in its table', () => {
    for (const mode of MODES) {
      const kinds = new Set<string>(aviaEventTable(mode).map((e) => e.kind));
      const { min, max } = AVIA.modes[mode].flightEvents;
      for (let n = 0; n < 300; n += 1) {
        const { events } = fly(ctx(n), mode);
        expect(events.length).toBeGreaterThanOrEqual(min);
        expect(events.length).toBeLessThanOrEqual(max);
        for (const e of events) {
          expect(kinds.has(e.kind)).toBe(true);
          expect(e.altitude).toBeGreaterThanOrEqual(0);
          expect(e.altitude).toBeLessThan(1);
        }
      }
    }
  });

  it('reports the running multiplier the events actually produce', () => {
    for (let n = 0; n < 200; n += 1) {
      const flight = fly(ctx(n), 'fast');
      let m = 1;
      for (const e of flight.events) {
        const spec = AVIA.events.find((s) => s.kind === e.kind)!;
        m = m * spec.mul + spec.add;
        expect(e.multiplier).toBe(Math.floor(Math.min(m, AVIA.maxMultiplier) * 100) / 100);
      }
      expect(flight.flightMultiplier).toBe(flight.events[flight.events.length - 1].multiplier);
    }
  });

  it('pays flight × spot on a landing and nothing on a ditch', () => {
    let sawLand = false;
    let sawDitch = false;
    const spots = new Set<string>();
    for (let n = 0; n < 400; n += 1) {
      const r = play({ mode: 'slow' }, ctx(n));
      const flight = r.resultData as unknown as {
        landed: boolean;
        flightMultiplier: number;
        spot: string | null;
        spotMultiplier: number;
      };
      expect(r.win).toBe(flight.landed);
      if (flight.landed) {
        sawLand = true;
        spots.add(flight.spot!);
        const expected = Math.floor(flight.flightMultiplier * flight.spotMultiplier * 100) / 100;
        expect(r.multiplier).toBe(Math.min(expected, AVIA.maxMultiplier));
      } else {
        sawDitch = true;
        expect(flight.spot).toBeNull();
        expect(r.multiplier).toBe(0);
      }
    }
    expect(sawLand && sawDitch).toBe(true);
    expect(spots.size).toBeGreaterThan(1);
  });
});
