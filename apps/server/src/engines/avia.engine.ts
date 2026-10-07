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
  altitude: number;
  multiplier: number;
}

export interface AviaFlight {
  mode: AviaMode;
  landed: boolean;
  safe: boolean;
  spot: AviaSpotId | null;
  spotMultiplier: number;
  events: AviaEvent[];
  flightMultiplier: number;
  payoutMultiplier: number;
}

export function landingChance(mode: AviaMode): number {
  return aviaLandingChance(mode, EDGE);
}

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

export function play(params: Record<string, unknown>, seed: SeedContext): EngineResult {
  const mode: AviaMode = isAviaMode(params.mode) ? params.mode : 'fast';
  const flight = fly(seed, mode, params.safe === true);
  return {
    win: flight.landed,
    multiplier: flight.payoutMultiplier,
    resultData: { ...flight },
  };
}
