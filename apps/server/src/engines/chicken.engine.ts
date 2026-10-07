import { CHICKEN, HOUSE_EDGE } from '../config/game.config';
import { chickenHazardAt, type ChickenMode } from '@frigat/shared';
import { floatAt } from './provable';
import type { SeedContext } from '../types/engine.types';

const EDGE = HOUSE_EDGE.CHICKEN;

export function isChickenMode(value: unknown): value is ChickenMode {
  return typeof value === 'string' && Object.hasOwn(CHICKEN.modes, value);
}

export function multiplierAt(mode: ChickenMode, lane: number): number {
  if (!Number.isInteger(lane) || lane < 0) {
    throw new Error(`chicken: lane must be a non-negative integer, got ${lane}`);
  }
  if (lane === 0) return 1;
  let survival = 1;
  for (let k = 1; k <= lane; k += 1) survival *= 1 - chickenHazardAt(mode, k);
  return Math.floor(((1 - EDGE) / survival) * 100) / 100;
}

export function maxLanes(mode: ChickenMode): number {
  let lane = 1;
  while (multiplierAt(mode, lane + 1) <= CHICKEN.maxMultiplier) lane += 1;
  return lane;
}

export function minCashoutLane(mode: ChickenMode): number {
  let lane = 1;
  while (multiplierAt(mode, lane) < CHICKEN.minCashoutMultiplier) lane += 1;
  return lane;
}

export function survives(mode: ChickenMode, lane: number, seed: SeedContext): boolean {
  if (!Number.isInteger(lane) || lane < 1) {
    throw new Error(`chicken: lane must be an integer >= 1, got ${lane}`);
  }
  return (
    floatAt(seed.serverSeed, seed.clientSeed, seed.nonce, lane - 1) >= chickenHazardAt(mode, lane)
  );
}

export function bustLane(mode: ChickenMode, seed: SeedContext): number | null {
  const last = maxLanes(mode);
  for (let lane = 1; lane <= last; lane += 1) {
    if (!survives(mode, lane, seed)) return lane;
  }
  return null;
}
