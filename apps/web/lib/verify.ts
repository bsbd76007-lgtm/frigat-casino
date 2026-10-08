'use client';

import {
  AVIA,
  AVIA_SPOT_CURSOR,
  aviaEventTable,
  aviaLandingChance as sharedAviaLandingChance,
  aviaPick,
  aviaSafeLandingMaxStake as sharedAviaSafeLandingMaxStake,
  CHICKEN,
  chickenHazardAt,
  type AviaEventKind,
  type AviaMode,
  type AviaSpotId,
  type ChickenMode,
} from '@frigat/shared/constants';

const OUTCOME_HEX_CHARS = 13;
const OUTCOME_DIVISOR = Math.pow(2, 52);

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function subtle(): SubtleCrypto {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.subtle) {
    throw new Error(
      'Web Crypto is unavailable — verification requires a secure (https) context.'
    );
  }
  return cryptoObj.subtle;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await subtle().digest('SHA-256', encoder.encode(input));
  return toHex(digest);
}

async function hmacHex(serverSeed: string, message: string): Promise<string> {
  const key = await subtle().importKey(
    'raw',
    encoder.encode(serverSeed),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await subtle().sign('HMAC', key, encoder.encode(message));
  return toHex(signature);
}

function floatFromHex(hex: string): number {
  return parseInt(hex.slice(0, OUTCOME_HEX_CHARS), 16) / OUTCOME_DIVISOR;
}

export async function calculateOutcome(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number> {
  if (!Number.isInteger(nonce) || nonce < 0) {
    throw new Error('nonce must be a non-negative integer');
  }
  return floatFromHex(await hmacHex(serverSeed, `${clientSeed}:${nonce}`));
}

export async function floatAt(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  cursor: number
): Promise<number> {
  return floatFromHex(
    await hmacHex(serverSeed, `${clientSeed}:${nonce}:${cursor}`)
  );
}

export async function provableShuffle(
  n: number,
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number[]> {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const r = await floatAt(serverSeed, clientSeed, nonce, n - 1 - i);
    const j = Math.floor(r * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function verifyCommitment(
  revealedServerSeed: string,
  publishedHash: string
): Promise<boolean> {
  const actual = await sha256Hex(revealedServerSeed);
  return actual.toLowerCase() === publishedHash.trim().toLowerCase();
}

const EDGE = {
  CRASH: 0.025,
  LIMBO: 0.06,
  CHICKEN: 0.06,
  AVIA: 0.1,
} as const;

const CRASH_MAX_MULTIPLIER = 1_000_000;
const LIMBO_MAX_MULTIPLIER = 1_000_000;

export async function verifyCrash(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number> {
  const u = await calculateOutcome(serverSeed, clientSeed, nonce);
  const raw = (1 - EDGE.CRASH) / (1 - u);
  const clamped = Math.min(raw, CRASH_MAX_MULTIPLIER);
  return Math.max(1, Math.floor(clamped * 100) / 100);
}

export async function verifyRoulette(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number> {
  const u = await calculateOutcome(serverSeed, clientSeed, nonce);
  return Math.floor(u * 37);
}

export async function verifyMines(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  minesCount: number
): Promise<number[]> {
  if (!Number.isInteger(minesCount) || minesCount < 1 || minesCount > 24) {
    throw new Error('minesCount must be an integer in [1, 24]');
  }
  const shuffled = await provableShuffle(25, serverSeed, clientSeed, nonce);
  return shuffled.slice(0, minesCount).sort((a, b) => a - b);
}

export function chickenMultiplierAt(mode: ChickenMode, lane: number): number {
  if (lane <= 0) return 1;
  let survival = 1;
  for (let k = 1; k <= lane; k += 1) survival *= 1 - chickenHazardAt(mode, k);
  return Math.floor(((1 - EDGE.CHICKEN) / survival) * 100) / 100;
}

export function chickenMaxLanes(mode: ChickenMode): number {
  let lane = 1;
  while (chickenMultiplierAt(mode, lane + 1) <= CHICKEN.maxMultiplier) lane += 1;
  return lane;
}

export function chickenMinCashoutLane(mode: ChickenMode): number {
  let lane = 1;
  while (chickenMultiplierAt(mode, lane) < CHICKEN.minCashoutMultiplier) lane += 1;
  return lane;
}

export async function verifyChicken(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  mode: ChickenMode
): Promise<number | null> {
  const last = chickenMaxLanes(mode);
  for (let lane = 1; lane <= last; lane += 1) {
    const draw = await floatAt(serverSeed, clientSeed, nonce, lane - 1);
    if (draw < chickenHazardAt(mode, lane)) return lane;
  }
  return null;
}

export function aviaLandingChance(mode: AviaMode): number {
  return sharedAviaLandingChance(mode, EDGE.AVIA);
}

export function aviaSafeLandingMaxStake(mode: AviaMode): number {
  return sharedAviaSafeLandingMaxStake(mode, EDGE.AVIA);
}

export async function verifyAvia(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  mode: AviaMode = 'fast',
  safe = false
): Promise<{
  landed: boolean;
  kinds: AviaEventKind[];
  multiplier: number;
  spot: AviaSpotId | null;
  payoutMultiplier: number;
}> {
  const draw = (cursor: number) => floatAt(serverSeed, clientSeed, nonce, cursor);
  const table = aviaEventTable(mode);

  const landed = safe || (await draw(0)) < aviaLandingChance(mode);
  const { min, max } = AVIA.modes[mode].flightEvents;
  const length = min + Math.floor((await draw(1)) * (max - min + 1));

  let m = 1;
  const kinds: AviaEventKind[] = [];
  for (let i = 0; i < length; i += 1) {
    const spec = aviaPick(table, await draw(2 + 2 * i));
    m = m * spec.mul + spec.add;
    kinds.push(spec.kind);
  }
  const floor2 = (v: number) => Math.floor(v * 100) / 100;
  const multiplier = floor2(Math.min(m, AVIA.maxMultiplier));
  const spot = landed ? aviaPick(AVIA.spots, await draw(AVIA_SPOT_CURSOR)) : null;
  const payoutMultiplier = spot
    ? floor2(Math.min(multiplier * spot.mul, AVIA.maxMultiplier))
    : 0;
  return { landed, kinds, multiplier, spot: spot?.id ?? null, payoutMultiplier };
}

export async function verifyDice(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number> {
  const u = await calculateOutcome(serverSeed, clientSeed, nonce);
  return u * 100;
}

export async function verifyLimbo(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<number> {
  const u = await calculateOutcome(serverSeed, clientSeed, nonce);
  const raw = (1 - EDGE.LIMBO) / (1 - u);
  const achieved = Math.max(1, Math.min(raw, LIMBO_MAX_MULTIPLIER));
  return Math.floor(achieved * 100) / 100;
}

export async function verifyCoinflip(
  serverSeed: string,
  clientSeed: string,
  nonce: number
): Promise<'HEADS' | 'TAILS'> {
  const u = await calculateOutcome(serverSeed, clientSeed, nonce);
  return u < 0.5 ? 'HEADS' : 'TAILS';
}

export type VerifiableGame =
  | 'CRASH'
  | 'ROULETTE'
  | 'MINES'
  | 'DICE'
  | 'LIMBO'
  | 'COINFLIP';

export const VERIFIABLE_GAMES: ReadonlyArray<{
  id: VerifiableGame;
  label: string;
}> = [
  { id: 'CRASH', label: 'Crash' },
  { id: 'MINES', label: 'Mines' },
  { id: 'ROULETTE', label: 'Roulette' },
  { id: 'DICE', label: 'Dice' },
  { id: 'LIMBO', label: 'Limbo' },
  { id: 'COINFLIP', label: 'Coinflip' },
];
