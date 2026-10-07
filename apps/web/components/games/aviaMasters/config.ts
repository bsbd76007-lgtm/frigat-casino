import {
  AVIA,
  type AviaEventKind,
  type AviaMode,
  type AviaSpotId,
} from '@frigat/shared/constants';

import { divideDecimal, multiplyDecimal } from '@/lib/decimal';

export const GAME_CONFIG = {
  currency: 'USD',
  minBet: '1.00',
  maxBet: '1000.00',
  maxAltitude: 1000,
  deckAltitude: 120,
  carrierLength: 300,
  cruiseSpeed: 330,
  catapultSeconds: 0.7,
  firstEventAt: 560,
  eventSpacing: 320,
  eventAltitude: [300, 880] as const,
  approach: 620,
  planeHalfWidth: 30,
  planeHalfHeight: 18,
  landingMs: 1250,
  maxPitchUp: 0.5,
  maxPitchDown: 0.85,
} as const;

export type Phase = 'IDLE' | 'WAITING' | 'FLYING' | 'LANDING' | 'LANDED' | 'CRASHED';

export interface PickupSpec {
  kind: AviaEventKind;
  label: string;
  hazard: boolean;
}

export const PICKUPS: readonly PickupSpec[] = AVIA.events.map((e) => ({
  kind: e.kind,
  label: e.label,
  hazard: e.mul < 1,
}));

export function specFor(kind: AviaEventKind): PickupSpec {
  return PICKUPS.find((p) => p.kind === kind) ?? PICKUPS[0];
}

export interface ServerEvent {
  kind: AviaEventKind;
  altitude: number;
  multiplier: number;
}

export interface PlannedEvent extends ServerEvent {
  x: number;
  alt: number;
}

export const SPEEDS: ReadonlyArray<{ id: AviaMode; pace: number }> = [
  { id: 'slow', pace: 0.6 },
  { id: 'fast', pace: 1.1 },
  { id: 'turbo', pace: 1.75 },
];

export function paceFor(mode: AviaMode): number {
  return SPEEDS.find((s) => s.id === mode)?.pace ?? 1;
}

const SPOT_LENGTH: Record<AviaSpotId, number> = { carrier: 300, island: 240, rig: 150 };
const SPOT_GAP = 300;

export interface PlacedSpot {
  id: AviaSpotId;
  mul: number;
  left: number;
  length: number;
}

export interface FlightPlan {
  landed: boolean;
  events: PlannedEvent[];
  points: ReadonlyArray<{ x: number; alt: number }>;
  spots: readonly PlacedSpot[];
  spot: PlacedSpot | null;
  finishX: number;
  endX: number;
}

const { deckAltitude, planeHalfHeight } = GAME_CONFIG;
export const ON_DECK = deckAltitude + planeHalfHeight;

export function planFlight(
  events: readonly ServerEvent[],
  landed: boolean,
  spotId: AviaSpotId | null = null
): FlightPlan {
  const [low, high] = GAME_CONFIG.eventAltitude;
  const planned: PlannedEvent[] = events.map((e, i) => ({
    ...e,
    x: GAME_CONFIG.firstEventAt + i * GAME_CONFIG.eventSpacing,
    alt: low + e.altitude * (high - low),
  }));

  const lastX = planned.length
    ? planned[planned.length - 1].x
    : GAME_CONFIG.firstEventAt - GAME_CONFIG.eventSpacing;
  const deckStart = lastX + GAME_CONFIG.approach;

  const spots: PlacedSpot[] = [];
  let left = deckStart;
  for (const spot of AVIA.spots) {
    const length = SPOT_LENGTH[spot.id];
    spots.push({ id: spot.id, mul: spot.mul, left, length });
    left += length + SPOT_GAP;
  }

  const points: Array<{ x: number; alt: number }> = [
    { x: 0, alt: ON_DECK },
    { x: GAME_CONFIG.firstEventAt * 0.45, alt: ON_DECK + 140 },
    ...planned.map((e) => ({ x: e.x, alt: e.alt })),
  ];

  const target = landed ? spots.find((s) => s.id === spotId) ?? spots[0] : null;
  let endX: number;
  if (target) {
    const index = spots.indexOf(target);
    for (let j = 0; j < index; j += 1) {
      const passed = spots[j];
      points.push({ x: passed.left + passed.length / 2, alt: ON_DECK + 230 });
    }
    points.push({ x: target.left - SPOT_GAP * 0.55, alt: ON_DECK + 100 });
    points.push({ x: target.left - 30, alt: ON_DECK + 12 });
    endX = target.left + target.length * 0.2;
    points.push({ x: endX, alt: ON_DECK });
  } else {
    points.push({ x: deckStart - GAME_CONFIG.approach * 0.5, alt: ON_DECK + 40 });
    endX = deckStart - 90;
    points.push({ x: endX, alt: 0 });
  }

  const finish = target ?? spots[0];
  return {
    landed,
    events: planned,
    points,
    spots,
    spot: target,
    finishX: finish.left + finish.length / 2,
    endX,
  };
}

export function altitudeAt(plan: FlightPlan, x: number): number {
  const pts = plan.points;
  if (x <= pts[0].x) return pts[0].alt;
  const last = pts[pts.length - 1];
  if (x >= last.x) return last.alt;

  let i = 0;
  while (i < pts.length - 2 && x > pts[i + 1].x) i += 1;
  const p0 = pts[i];
  const p1 = pts[i + 1];

  const slope = (k: number) => {
    if (k <= 0 || k >= pts.length - 1) return 0;
    return (pts[k + 1].alt - pts[k - 1].alt) / (pts[k + 1].x - pts[k - 1].x);
  };
  const h = p1.x - p0.x;
  const t = (x - p0.x) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const alt =
    (2 * t3 - 3 * t2 + 1) * p0.alt +
    (t3 - 2 * t2 + t) * h * slope(i) +
    (-2 * t3 + 3 * t2) * p1.alt +
    (t3 - t2) * h * slope(i + 1);

  const floor = plan.landed || i < pts.length - 2 ? planeHalfHeight : 0;
  return Math.min(GAME_CONFIG.maxAltitude - planeHalfHeight, Math.max(floor, alt));
}

export function formatMultiplier(value: number): string {
  if (value >= 10_000) return `${Math.round(value / 1000)}Kx`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}Kx`;
  if (value >= 100) return `${value.toFixed(0)}x`;
  return `${value.toFixed(2)}x`;
}

export function formatMetres(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')} m`;
}

export function payoutFor(bet: string, multiplier: number): string {
  const hundredths = BigInt(Math.max(0, Math.round(multiplier * 100)));
  return divideDecimal(multiplyDecimal(bet, hundredths), 100n);
}
