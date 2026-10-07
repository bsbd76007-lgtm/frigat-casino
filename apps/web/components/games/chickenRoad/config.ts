import { CHICKEN, chickenHazardAt, type ChickenMode } from '@frigat/shared/constants';

import { chickenMaxLanes, chickenMinCashoutLane, chickenMultiplierAt } from '@/lib/verify';

export const GAME_CONFIG = {
  minBet: 1,
  maxBet: 1000,
  currency: '$',
  visibleLanes: 5,
  lookahead: 8,
  lookbehind: 2,
  minCashoutLane: 5,
} as const;

export type Phase = 'IDLE' | 'PLAYING' | 'WON' | 'LOST';

export interface TrafficMode {
  id: ChickenMode;
  label: string;
  difficulty: number;
  gap: readonly [number, number];
  speed: readonly [number, number];
}

export const TRAFFIC_MODES: readonly TrafficMode[] = [
  mode('low', [1.7, 2.7], [0.64, 0.92]),
  mode('medium', [1.1, 1.9], [0.78, 1.1]),
  mode('high', [0.7, 1.2], [0.98, 1.4]),
  mode('extreme', [0.4, 0.8], [1.22, 1.75]),
  mode('hardcore', [0.25, 0.55], [1.5, 2.15]),
] as const;

function mode(
  id: ChickenMode,
  gap: readonly [number, number],
  speed: readonly [number, number]
): TrafficMode {
  const difficulty = CHICKEN.modes[id].hazard;
  return { id, label: `${Math.round(difficulty * 100)}%`, difficulty, gap, speed };
}

export const DEFAULT_MODE = TRAFFIC_MODES[1];

export const PIXEL_SIZE = 1;

export const COLOR_LEVELS = 0;

export const HOP_MS = 320;

export const LAYOUT = {
  chickenY: 0.6,
  gateY: 0.42,
  tunnelY: 0.3,
} as const;

export interface Geometry {
  carLen: number;
  carHalf: number;
  chickenHalf: number;
}

export const SEED_GEOMETRY: Geometry = { carLen: 0.14, carHalf: 0.07, chickenHalf: 0.02 };

export const FOLLOW_GAP = 0.03;

export function laneDirection(_lane: number): 1 | -1 {
  return 1;
}

export function gateFraction(lane: number): number {
  return laneDirection(lane) > 0 ? LAYOUT.gateY : 1 - LAYOUT.gateY;
}

export function multiplierAt(lane: number, trafficMode: TrafficMode): number {
  return chickenMultiplierAt(trafficMode.id, lane);
}

export function unlockLane(trafficMode: TrafficMode): number {
  return chickenMinCashoutLane(trafficMode.id);
}

export function lastLane(trafficMode: TrafficMode): number {
  return chickenMaxLanes(trafficMode.id);
}

export function crossingChanceAt(lane: number, trafficMode: TrafficMode): number {
  return 1 - chickenHazardAt(trafficMode.id, lane);
}

export function cumulativeChanceAt(lane: number, trafficMode: TrafficMode): number {
  let chance = 1;
  for (let k = 1; k <= lane; k += 1) chance *= crossingChanceAt(k, trafficMode);
  return chance;
}

export function money(value: number): string {
  return `${GAME_CONFIG.currency}${value.toFixed(2)}`;
}

export function formatMultiplier(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}K`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  if (value >= 100) return value.toFixed(0);
  return value.toFixed(2);
}

export function formatChance(chance: number): string {
  const pct = chance * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

export function randomBetween([min, max]: readonly [number, number]): number {
  return min + Math.random() * (max - min);
}
