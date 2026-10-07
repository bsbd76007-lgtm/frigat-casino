export const BET_LIMITS = {
  min: '0.10',
  max: '10000.00',
} as const;

export const MINES = {
  gridSize: 25,
  minMines: 5,
  maxMines: 24,
} as const;

export const CHICKEN = {
  maxMultiplier: 10_000,
  minCashoutMultiplier: 2,
  ramp: { start: 0.4, lanes: 5 },
  modes: {
    low: { hazard: 0.2 },
    medium: { hazard: 0.3 },
    high: { hazard: 0.5 },
    extreme: { hazard: 0.7 },
    hardcore: { hazard: 0.85 },
  },
} as const;

export type ChickenMode = keyof typeof CHICKEN.modes;

export function chickenHazardAt(mode: ChickenMode, lane: number): number {
  const { start, lanes } = CHICKEN.ramp;
  const progress = Math.min(1, (lane - 1) / (lanes - 1));
  return CHICKEN.modes[mode].hazard * (start + (1 - start) * progress);
}

export const AVIA = {
  maxMultiplier: 10_000,
  events: [
    { kind: 'add025', label: '+0.25', mul: 1, add: 0.25 },
    { kind: 'add05', label: '+0.5', mul: 1, add: 0.5 },
    { kind: 'add1', label: '+1', mul: 1, add: 1 },
    { kind: 'add2', label: '+2', mul: 1, add: 2 },
    { kind: 'add5', label: '+5', mul: 1, add: 5 },
    { kind: 'x2', label: 'x2', mul: 2, add: 0 },
    { kind: 'x3', label: 'x3', mul: 3, add: 0 },
    { kind: 'x5', label: 'x5', mul: 5, add: 0 },
    { kind: 'x10', label: 'x10', mul: 10, add: 0 },
    { kind: 'rocket', label: 'x0.5', mul: 0.5, add: 0 },
    { kind: 'bomb', label: 'x0.25', mul: 0.25, add: 0 },
  ],
  modes: {
    slow: {
      flightEvents: { min: 10, max: 16 },
      weights: {
        add025: 12, add05: 9, add1: 4, add2: 1.2, add5: 0.3,
        x2: 2.5, x3: 0.7, x5: 0.15, x10: 0.03, rocket: 9, bomb: 2,
      },
    },
    fast: {
      flightEvents: { min: 8, max: 13 },
      weights: {
        add025: 8, add05: 7, add1: 4.5, add2: 2, add5: 0.8,
        x2: 3.5, x3: 1.2, x5: 0.4, x10: 0.1, rocket: 11, bomb: 3.5,
      },
    },
    turbo: {
      flightEvents: { min: 6, max: 10 },
      weights: {
        add025: 4, add05: 5, add1: 4, add2: 3, add5: 1.6,
        x2: 4, x3: 2, x5: 0.8, x10: 0.25, rocket: 12, bomb: 5,
      },
    },
  },
  spots: [
    { id: 'carrier', label: 'Carrier', mul: 1, weight: 6 },
    { id: 'island', label: 'Island', mul: 1.5, weight: 3 },
    { id: 'rig', label: 'Oil rig', mul: 3, weight: 1 },
  ],
  safeLanding: { fee: 5 },
} as const;

export const AVIA_SPOT_CURSOR = 1000;

export type AviaEventKind = (typeof AVIA.events)[number]['kind'];
export type AviaMode = keyof typeof AVIA.modes;
export type AviaSpotId = (typeof AVIA.spots)[number]['id'];

export interface AviaEventSpec {
  kind: AviaEventKind;
  label: string;
  mul: number;
  add: number;
  weight: number;
}

export function isAviaMode(value: unknown): value is AviaMode {
  return typeof value === 'string' && Object.hasOwn(AVIA.modes, value);
}

export function aviaEventTable(mode: AviaMode): AviaEventSpec[] {
  const weights = AVIA.modes[mode].weights as Record<AviaEventKind, number>;
  return AVIA.events
    .map((e) => ({ ...e, weight: weights[e.kind] ?? 0 }))
    .filter((e) => e.weight > 0);
}

export function aviaPick<T extends { weight: number }>(table: readonly T[], u: number): T {
  const total = table.reduce((sum, e) => sum + e.weight, 0);
  let roll = u * total;
  for (const entry of table) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return table[table.length - 1];
}

export function aviaExpectedMultiplier(mode: AviaMode): number {
  const table = aviaEventTable(mode);
  const total = table.reduce((sum, e) => sum + e.weight, 0);
  const meanMul = table.reduce((s, e) => s + e.weight * e.mul, 0) / total;
  const meanAdd = table.reduce((s, e) => s + e.weight * e.add, 0) / total;
  const { min, max } = AVIA.modes[mode].flightEvents;
  let sum = 0;
  for (let n = min; n <= max; n += 1) {
    let m = 1;
    for (let i = 0; i < n; i += 1) m = meanMul * m + meanAdd;
    sum += m;
  }
  return sum / (max - min + 1);
}

export function aviaExpectedSpot(): number {
  const total = AVIA.spots.reduce((sum, s) => sum + s.weight, 0);
  return AVIA.spots.reduce((s, spot) => s + spot.weight * spot.mul, 0) / total;
}

export function aviaLandingChance(mode: AviaMode, edge: number): number {
  return (1 - edge) / (aviaExpectedMultiplier(mode) * aviaExpectedSpot());
}

export function aviaSafeLandingMaxStake(mode: AviaMode, edge: number): number {
  const rtp = 1 - edge;
  const value = aviaExpectedMultiplier(mode) * aviaExpectedSpot();
  if (value <= rtp) return Number.POSITIVE_INFINITY;
  return Math.floor(((rtp * AVIA.safeLanding.fee) / (value - rtp)) * 100) / 100;
}

export const CRASH = {
  bettingWindowMs: 5000,
  tickMs: 100,
  growthRatePerSec: 0.06,
  maxMultiplier: 1_000_000,
} as const;

export const ROULETTE_RED: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export const ROULETTE_WHEEL_ORDER: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24,
  16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

export const PLINKO_TABLES: Record<
  'LOW' | 'MEDIUM' | 'HIGH',
  Record<number, number[]>
> = {
  LOW: {
    8: [5.49, 2.06, 1.08, 0.99, 0.49, 0.99, 1.08, 2.06, 5.49],
    12: [9.85, 2.96, 1.59, 1.37, 1.08, 0.99, 0.49, 0.99, 1.08, 1.37, 1.59, 2.96, 9.85],
    16: [15.76, 8.86, 1.97, 1.36, 1.38, 1.18, 1.08, 0.99, 0.49, 0.99, 1.08, 1.18, 1.38, 1.36, 1.97, 8.86, 15.76],
  },
  MEDIUM: {
    8: [12.83, 2.98, 1.28, 0.69, 0.39, 0.69, 1.28, 2.98, 12.83],
    12: [32.5, 10.81, 3.95, 1.97, 1.08, 0.59, 0.3, 0.59, 1.08, 1.97, 3.95, 10.81, 32.5],
    16: [108.35, 40.38, 9.86, 4.91, 2.95, 1.49, 0.98, 0.49, 0.3, 0.49, 0.98, 1.49, 2.95, 4.91, 9.86, 40.38, 108.35],
  },
  HIGH: {
    8: [28.52, 3.95, 1.48, 0.29, 0.2, 0.29, 1.48, 3.95, 28.52],
    12: [167.23, 23.62, 7.96, 1.97, 0.68, 0.2, 0.2, 0.2, 0.68, 1.97, 7.96, 23.62, 167.23],
    16: [985.08, 128.06, 25.63, 8.87, 3.94, 1.97, 0.19, 0.2, 0.2, 0.2, 0.19, 1.97, 3.94, 8.87, 25.63, 128.06, 985.08],
  },
};

export const PLINKO_ROWS = [8, 12, 16] as const;
export type PlinkoRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export type RoulettePocketColor = 'GREEN' | 'RED' | 'BLACK';

export function pocketColor(pocket: number): RoulettePocketColor {
  if (pocket === 0) return 'GREEN';
  return ROULETTE_RED.has(pocket) ? 'RED' : 'BLACK';
}

export const LIMBO = {
  minMultiplier: 1.01,
  maxMultiplier: 1_000_000,
} as const;

export const KENO_TILE_COUNT = 40;
export const KENO_DRAW_COUNT = 10;
export const KENO_MAX_PICKS = 10;

export const KENO_PAYTABLE: Record<number, Record<number, number>> = {
  1: { 0: 0, 1: 3.9 },
  2: { 0: 0, 1: 1.01, 2: 10.16 },
  3: { 0: 0, 1: 0, 2: 4.28, 3: 32.12 },
  4: { 0: 0, 1: 0, 2: 1.77, 3: 10.59, 4: 77.78 },
  5: { 0: 0, 1: 0, 2: 0, 3: 6.87, 4: 36.67, 5: 206.05 },
  6: { 0: 0, 1: 0, 2: 0, 3: 3.18, 4: 15.9, 5: 84.73, 6: 476.66 },
  7: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 11.53, 5: 57.68, 6: 288.34, 7: 1729.9 },
  8: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 5.49, 5: 27.51, 6: 137.39, 7: 687.16, 8: 4810.11 },
  9: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 23.63, 6: 94.55, 7: 393.91, 8: 1575.64, 9: 11029.5 },
  10: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 11.72, 6: 46.86, 7: 234.37, 8: 1054.52, 9: 3515.21, 10: 23434.75 },
};

export const SLOTS_REELS = 5;
export const SLOTS_ROWS = 3;

export const SLOTS_SYMBOLS = [
  'CHERRY',
  'LEMON',
  'ORANGE',
  'PLUM',
  'BELL',
  'BAR',
  'SEVEN',
  'WILD',
] as const;

export type SlotSymbol = (typeof SLOTS_SYMBOLS)[number];

export const SLOTS_WEIGHTS: Record<SlotSymbol, number> = {
  CHERRY: 22,
  LEMON: 20,
  ORANGE: 18,
  PLUM: 15,
  BELL: 11,
  BAR: 7,
  SEVEN: 4,
  WILD: 3,
};

export const SLOTS_PAYTABLE: Record<SlotSymbol, Record<3 | 4 | 5, number>> = {
  CHERRY: { 3: 5, 4: 25, 5: 100 },
  LEMON: { 3: 7, 4: 30, 5: 150 },
  ORANGE: { 3: 10, 4: 40, 5: 175 },
  PLUM: { 3: 12, 4: 55, 5: 225 },
  BELL: { 3: 18, 4: 70, 5: 275 },
  BAR: { 3: 30, 4: 150, 5: 550 },
  SEVEN: { 3: 55, 4: 275, 5: 2500 },
  WILD: { 3: 250, 4: 1000, 5: 10_000 },
};

export const SLOTS_PAYLINES: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
] as const;

export const SLOTS_PAYLINE_NAMES = [
  'Top row',
  'Middle row',
  'Bottom row',
  'V shape',
  'Inverted V',
] as const;

export const PASSWORD_POLICY = {
  minLength: 8,
  maxLength: 200,
} as const;

export interface PasswordProblem {
  code: 'too_short' | 'too_long' | 'missing_uppercase' | 'missing_lowercase' | 'missing_digit';
  message: string;
}

export function passwordProblems(password: string): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (password.length < PASSWORD_POLICY.minLength) {
    problems.push({
      code: 'too_short',
      message: `At least ${PASSWORD_POLICY.minLength} characters`,
    });
  }
  if (password.length > PASSWORD_POLICY.maxLength) {
    problems.push({
      code: 'too_long',
      message: `At most ${PASSWORD_POLICY.maxLength} characters`,
    });
  }
  if (!/[A-Z]/.test(password)) {
    problems.push({ code: 'missing_uppercase', message: 'An uppercase letter' });
  }
  if (!/[a-z]/.test(password)) {
    problems.push({ code: 'missing_lowercase', message: 'A lowercase letter' });
  }
  if (!/[0-9]/.test(password)) {
    problems.push({ code: 'missing_digit', message: 'A number' });
  }
  return problems;
}

export function isPasswordAcceptable(password: string): boolean {
  return passwordProblems(password).length === 0;
}
