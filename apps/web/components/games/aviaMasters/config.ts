/**
 * Avia Masters — configuration, the flight plan and display formatting.
 *
 * Pure values and pure functions: no canvas, no React. Nothing here decides an
 * outcome. The server's engine (apps/server/src/engines/avia.engine.ts) rolls
 * the whole flight from the round's seed; `planFlight` only lays that result
 * out in the sky so the component can fly it.
 */

import {
  AVIA,
  type AviaEventKind,
  type AviaMode,
  type AviaSpotId,
} from '@frigat/shared/constants';

import { divideDecimal, multiplyDecimal } from '@/lib/decimal';

// ─────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────

export const GAME_CONFIG = {
  currency: 'USD',
  minBet: '1.00',
  maxBet: '1000.00',
  /** Ceiling of the drawn column, in metres. */
  maxAltitude: 1000,
  /**
   * The one baseline. The launch carrier's deck, the finish carrier's deck and
   * the foot of the finish marker all sit on this altitude — every deck in the
   * run is drawn from it, so none can drift above or below another.
   */
  deckAltitude: 120,
  /** Deck length of both carriers, in metres. */
  carrierLength: 300,
  /**
   * Ground speed once airborne, in metres per second. Sets the flight's length:
   * the longest flight the engine can roll (12 events) runs about 14 s.
   */
  cruiseSpeed: 330,
  /** Seconds the catapult takes to bring the plane up to cruise. */
  catapultSeconds: 0.7,
  /** Where the first pickup or rocket sits, measured from the launch point. */
  firstEventAt: 560,
  /** Distance between consecutive pickups — one a second at cruise. */
  eventSpacing: 320,
  /** Altitude band the server's 0–1 event altitudes are mapped into. */
  eventAltitude: [300, 880] as const,
  /** From the last event to the near end of the finish carrier. */
  approach: 620,
  /** Plane bounding box, in metres. */
  planeHalfWidth: 30,
  planeHalfHeight: 18,
  /** How long the rollout on the finish deck runs before the round settles. */
  landingMs: 1250,
  /** Nose-up and nose-down limits, in radians. */
  maxPitchUp: 0.5,
  maxPitchDown: 0.85,
} as const;

/**
 * WAITING is the gap between pressing Fly and the server's flight arriving —
 * the plane sits on the catapult until then.
 */
export type Phase = 'IDLE' | 'WAITING' | 'FLYING' | 'LANDING' | 'LANDED' | 'CRASHED';

export interface PickupSpec {
  kind: AviaEventKind;
  label: string;
  /** Rockets are the only hazard: they halve the running multiplier. */
  hazard: boolean;
}

/** Display table, straight from the engine's own table in @frigat/shared. */
export const PICKUPS: readonly PickupSpec[] = AVIA.events.map((e) => ({
  kind: e.kind,
  label: e.label,
  // Anything that divides the multiplier is a bomb, whatever it is called.
  hazard: e.mul < 1,
}));

export function specFor(kind: AviaEventKind): PickupSpec {
  return PICKUPS.find((p) => p.kind === kind) ?? PICKUPS[0];
}

// ─────────────────────────────────────────────
// Flight plan
// ─────────────────────────────────────────────

/** One event as the server reports it in GAME_RESULT.resultData.events. */
export interface ServerEvent {
  kind: AviaEventKind;
  /** 0 (sea) to 1 (ceiling), from the seed. */
  altitude: number;
  /** Running multiplier once this event is applied. */
  multiplier: number;
}

export interface PlannedEvent extends ServerEvent {
  /** World position along the run, in metres. */
  x: number;
  /** World altitude, in metres. */
  alt: number;
}

/**
 * The three speeds. `pace` scales the cruise speed the animation flies at; the
 * odds of each speed are the server's (AVIA.modes in @frigat/shared).
 */
export const SPEEDS: ReadonlyArray<{ id: AviaMode; pace: number }> = [
  { id: 'slow', pace: 0.6 },
  { id: 'fast', pace: 1.1 },
  { id: 'turbo', pace: 1.75 },
];

export function paceFor(mode: AviaMode): number {
  return SPEEDS.find((s) => s.id === mode)?.pace ?? 1;
}

/** How long each landing spot's deck is, in world metres. */
const SPOT_LENGTH: Record<AviaSpotId, number> = { carrier: 300, island: 240, rig: 150 };
/** Open water between one spot and the next. */
const SPOT_GAP = 300;

export interface PlacedSpot {
  id: AviaSpotId;
  mul: number;
  /** Left edge of the deck, in world metres. */
  left: number;
  length: number;
}

export interface FlightPlan {
  landed: boolean;
  events: PlannedEvent[];
  /** Waypoints the path runs through, strictly increasing in x. */
  points: ReadonlyArray<{ x: number; alt: number }>;
  /** Every landing spot, in the order the plane reaches them. */
  spots: readonly PlacedSpot[];
  /** The spot the flight came down on; null when it ditched. */
  spot: PlacedSpot | null;
  /** Centre of the deck it lands on (or of the first deck, for a ditch). */
  finishX: number;
  /** Where the flight ends: wheels on the deck, or the splash short of it. */
  endX: number;
}

const { deckAltitude, planeHalfHeight } = GAME_CONFIG;
/** Altitude of the plane's centre when its wheels are on a deck. */
export const ON_DECK = deckAltitude + planeHalfHeight;

/**
 * Lays the server's flight out in the sky: every event where the plane will
 * meet it, then the landing spots in a row — carrier, island, oil rig. A
 * landing overflies the spots before the one the server chose and glides onto
 * it; a ditch sinks into the sea just short of the first.
 */
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
    // Hold altitude over every spot the flight passes up.
    for (let j = 0; j < index; j += 1) {
      const passed = spots[j];
      points.push({ x: passed.left + passed.length / 2, alt: ON_DECK + 230 });
    }
    // A flattening glide that meets the deck a fifth of the way in.
    points.push({ x: target.left - SPOT_GAP * 0.55, alt: ON_DECK + 100 });
    points.push({ x: target.left - 30, alt: ON_DECK + 12 });
    endX = target.left + target.length * 0.2;
    points.push({ x: endX, alt: ON_DECK });
  } else {
    // Sinks out of the approach and meets the water short of the first bow.
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

/**
 * Altitude of the flight path at world distance `x`: a cubic Hermite spline
 * through the waypoints, with x as the independent variable so it is a true
 * function of distance. Tangents are central differences, pinned flat at both
 * ends so the take-off and the touchdown ease rather than kink.
 */
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

  // The spline may bulge a little past a waypoint; it must never leave the
  // column, and must not touch the water before a ditching flight means to.
  const floor = plan.landed || i < pts.length - 2 ? planeHalfHeight : 0;
  return Math.min(GAME_CONFIG.maxAltitude - planeHalfHeight, Math.max(floor, alt));
}

// ─────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────

export function formatMultiplier(value: number): string {
  if (value >= 10_000) return `${Math.round(value / 1000)}Kx`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}Kx`;
  if (value >= 100) return `${value.toFixed(0)}x`;
  return `${value.toFixed(2)}x`;
}

export function formatMetres(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')} m`;
}

/**
 * Stake times multiplier, in exact decimal — for the live readout only. What a
 * player is actually paid is the `payout` the server settles in GAME_RESULT.
 *
 * The multiplier is a float, so it is taken to two places and folded in as an
 * integer — parsing the *stake* into a JS number would reintroduce exactly the
 * drift `Decimal(18,8)` and `lib/decimal.ts` exist to prevent.
 */
export function payoutFor(bet: string, multiplier: number): string {
  const hundredths = BigInt(Math.max(0, Math.round(multiplier * 100)));
  return divideDecimal(multiplyDecimal(bet, hundredths), 100n);
}
