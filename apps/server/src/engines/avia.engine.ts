/**
 * FRIGAT — Avia Masters Engine
 *
 * One bet is one flight, decided whole before the client draws a frame. The
 * player picks a speed, optionally buys a safe landing, launches and watches;
 * there is no input mid-air.
 *
 * Draws come from the round's provable float stream (see `provable.ts`):
 *
 *     cursor 0          landing draw — the flight lands when it is < P(land)
 *     cursor 1          flight length, uniform over the mode's flightEvents
 *     cursor 2 + 2i     kind of event i, weighted by the mode's table
 *     cursor 3 + 2i     altitude of event i, in [0, 1) — trajectory only
 *     cursor SPOT       which landing spot, weighted by AVIA.spots
 *
 * The tables and every price — E[M], E[spot], P(land), the safe-landing stake
 * cap — live in @frigat/shared, so the web verifier replays the same maths
 * from the same code. See AVIA there for why the edge holds in every mode.
 *
 * A safe landing skips the landing draw (the flight lands whatever cursor 0
 * says) but changes nothing else: the same seed gives the same events and the
 * same spot, so a safe round is replayable exactly like an ordinary one.
 */

import {
  AVIA,
  AVIA_SPOT_CURSOR,
  aviaEventTable,
  aviaLandingChance,
  aviaPick,
  aviaSafeLandingMaxStake,
  isAviaMode,
  type AviaEventKind,
  type AviaMode,
  type AviaSpotId,
} from '@frigat/shared';
import { HOUSE_EDGE } from '../config/game.config';
import { floatAt } from './provable';
import type { EngineResult, SeedContext } from '../types/engine.types';

const EDGE = HOUSE_EDGE.AVIA;

export { isAviaMode };

export interface AviaEvent {
  kind: AviaEventKind;
  /** Where on the flight path the event sits, 0 (sea) to 1 (ceiling). */
  altitude: number;
  /** Running multiplier once this event is applied, floored to 2 dp. */
  multiplier: number;
}

export interface AviaFlight {
  mode: AviaMode;
  landed: boolean;
  /** True when the landing was bought rather than drawn. */
  safe: boolean;
  /** Where the flight came down; null when it ditched. */
  spot: AviaSpotId | null;
  spotMultiplier: number;
  events: AviaEvent[];
  /** What the flight collected, whether or not it landed. */
  flightMultiplier: number;
  /** What a landing pays: the flight times the spot's bonus. 0 on a ditch. */
  payoutMultiplier: number;
}

/** The chance a flight in `mode` lands, priced so the round returns 1 - edge. */
export function landingChance(mode: AviaMode): number {
  return aviaLandingChance(mode, EDGE);
}

/** The largest stake a safe landing may cover in `mode`. */
export function safeLandingMaxStake(mode: AviaMode): number {
  return aviaSafeLandingMaxStake(mode, EDGE);
}

const floor2 = (m: number) => Math.floor(m * 100) / 100;

export function fly(seed: SeedContext, mode: AviaMode = 'fast', safe = false): AviaFlight {
  const draw = (cursor: number) =>
    floatAt(seed.serverSeed, seed.clientSeed, seed.nonce, cursor);

  const table = aviaEventTable(mode);
  const landed = safe || draw(0) < landingChance(mode);
  const { min, max } = AVIA.modes[mode].flightEvents;
  const length = min + Math.floor(draw(1) * (max - min + 1));

  let m = 1;
  const events: AviaEvent[] = [];
  for (let i = 0; i < length; i += 1) {
    const spec = aviaPick(table, draw(2 + 2 * i));
    m = m * spec.mul + spec.add;
    events.push({
      kind: spec.kind,
      altitude: draw(3 + 2 * i),
      multiplier: floor2(Math.min(m, AVIA.maxMultiplier)),
    });
  }

  const flightMultiplier = floor2(Math.min(m, AVIA.maxMultiplier));
  const spot = landed ? aviaPick(AVIA.spots, draw(AVIA_SPOT_CURSOR)) : null;
  const spotMultiplier = spot?.mul ?? 0;
  const payoutMultiplier = landed
    ? floor2(Math.min(flightMultiplier * spotMultiplier, AVIA.maxMultiplier))
    : 0;

  return {
    mode,
    landed,
    safe,
    spot: spot?.id ?? null,
    spotMultiplier,
    events,
    flightMultiplier,
    payoutMultiplier,
  };
}

/**
 * Instant-engine entry point. `mode` picks the speed; `safe` is honoured only
 * when the socket handler has already charged the fee and checked the stake
 * cap — see handleInstantBet.
 */
export function play(params: Record<string, unknown>, seed: SeedContext): EngineResult {
  const mode: AviaMode = isAviaMode(params.mode) ? params.mode : 'fast';
  const flight = fly(seed, mode, params.safe === true);
  return {
    win: flight.landed,
    // A landing pays what the flight collected times the spot — below 1x after
    // enough bombs, which is a partial return, not a loss. A ditch pays nothing.
    multiplier: flight.payoutMultiplier,
    resultData: { ...flight },
  };
}
