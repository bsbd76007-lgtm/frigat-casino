import { calculateOutcome } from '@frigat/shared';
import { CRASH, HOUSE_EDGE } from '../config/game.config';
import type { SeedContext } from '../types/engine.types';

const EDGE = HOUSE_EDGE.CRASH;

export function computeCrashPoint(seed: SeedContext): number {
  const u = calculateOutcome(seed.serverSeed, seed.clientSeed, seed.nonce);
  const raw = (1 - EDGE) / (1 - u);
  const clamped = Math.min(raw, CRASH.maxMultiplier);
  return Math.max(1, Math.floor(clamped * 100) / 100);
}

export function multiplierAtElapsed(elapsedMs: number): number {
  const seconds = Math.max(0, elapsedMs) / 1000;
  const m = Math.exp(CRASH.growthRatePerSec * seconds);
  return Math.max(1, Math.floor(m * 100) / 100);
}

export function elapsedForMultiplier(target: number): number {
  if (target <= 1) return 0;
  const seconds = Math.log(target) / CRASH.growthRatePerSec;
  return seconds * 1000;
}
