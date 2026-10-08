import { CRYPTO_CODES, CRYPTO_CURRENCIES, isValidCryptoAddress } from '@frigat/shared';
import assert from 'assert';
import { describe, it } from 'vitest';
import { createHmac } from 'crypto';
import {
  canonicalIpnPayload,
  mapNowPaymentsStatus,
  payCurrencyFor,
  verifyIpnSignature,
} from '../services/nowpayments.service';
import {
  generateServerSeed,
  hashServerSeed,
  calculateOutcome,
  verifySeedCommitment,
} from '@frigat/shared';
import * as dice from './dice.engine';
import * as coinflip from './coinflip.engine';
import * as roulette from './roulette.engine';
import * as plinko from './plinko.engine';
import * as crash from './crash.engine';
import * as mines from './mines.engine';
import * as limbo from './limbo.engine';
import * as keno from './keno.engine';
import * as slots from './slots.engine';
import { floatAt, provableShuffle } from './provable';
import {
  KENO_PAYTABLE,
  SLOTS_PAYLINES,
  SLOTS_PAYTABLE,
  SLOTS_REELS,
  SLOTS_ROWS,
  SLOTS_SYMBOLS,
  SLOTS_WEIGHTS,
  type SlotSymbol,
} from '@frigat/shared';
import { HOUSE_EDGE } from '../config/game.config';
import type { SeedContext } from '../types/engine.types';

function ctx(nonce = 0): SeedContext {
  const serverSeed = 'a'.repeat(64);
  return {
    serverSeed,
    clientSeed: 'player-seed',
    nonce,
    hashedServerSeed: hashServerSeed(serverSeed),
  };
}


describe('Provably-fair core', () => {
  it('serverSeed is 64 hex chars', () => {
  const s = generateServerSeed();
  assert.match(s, /^[0-9a-f]{64}$/);
});
  it('commitment verifies', () => {
  const s = generateServerSeed();
  assert.equal(verifySeedCommitment(s, hashServerSeed(s)), true);
  assert.equal(verifySeedCommitment(s, hashServerSeed('other')), false);
});
  it('calculateOutcome ∈ [0,1) and deterministic', () => {
  const a = calculateOutcome('seed', 'client', 0);
  const b = calculateOutcome('seed', 'client', 0);
  assert.equal(a, b);
  assert.ok(a >= 0 && a < 1);
});
  it('floatAt stream is deterministic & distinct per cursor', () => {
  const a0 = floatAt('s', 'c', 0, 0);
  const a1 = floatAt('s', 'c', 0, 1);
  assert.equal(a0, floatAt('s', 'c', 0, 0));
  assert.notEqual(a0, a1);
});
  it('provableShuffle is a permutation', () => {
  const sh = provableShuffle(25, 's', 'c', 0);
  assert.equal(sh.length, 25);
  assert.equal(new Set(sh).size, 25);
  assert.deepEqual([...sh].sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i));
});

});

describe('Dice', () => {
  it('UNDER win pays ~ (100/chance)*(1-edge)', () => {
  const r = dice.play({ target: 50, direction: 'UNDER' }, ctx(0));
  assert.ok(typeof r.multiplier === 'number');
  const win = dice.play({ target: 99, direction: 'UNDER' }, ctx(0));
  if (win.win) assert.ok(win.multiplier > 0 && win.multiplier < 1.02);
});
  it('dice rejects bad target', () => {
  assert.throws(() => dice.play({ target: 0, direction: 'UNDER' }, ctx()));
  assert.throws(() => dice.play({ target: 100, direction: 'OVER' }, ctx()));
});

});

describe('Coinflip', () => {
  it('coinflip multiplier is 0 or ~1.98', () => {
  const r = coinflip.play({ side: 'HEADS' }, ctx(3));
  assert.ok(r.multiplier === 0 || Math.abs(r.multiplier - 1.98) < 0.001);
});

});

describe('Roulette', () => {
  it('pocket in 0..36, edge from single zero', () => {
  const r = roulette.spin({ bets: [{ position: 'red', amount: '1' }] }, ctx(7));
  const pocket = (r.resultData as any).pocket;
  assert.ok(pocket >= 0 && pocket <= 36);
});
  it('straight bet pays 36x gross when hit', () => {
  for (let n = 0; n < 500; n++) {
    const r = roulette.spin({ bets: [{ position: 'straight:17', amount: '1' }] }, ctx(n));
    if ((r.resultData as any).pocket === 17) {
      assert.equal(r.multiplier, 36);
      return;
    }
  }
  throw new Error('never hit pocket 17 in 500 tries (suspicious)');
});

});

describe('Plinko', () => {
  it('bucket in [0,rows], multiplier from table', () => {
  const r = plinko.drop({ rows: 16, risk: 'HIGH' }, ctx(2));
  const bucket = (r.resultData as any).bucket;
  assert.ok(bucket >= 0 && bucket <= 16);
  assert.ok((r.resultData as any).path.length === 16);
});

});

describe('Crash', () => {
  it('crashPoint >= 1.00, deterministic', () => {
  const cp1 = crash.computeCrashPoint(ctx(5));
  const cp2 = crash.computeCrashPoint(ctx(5));
  assert.equal(cp1, cp2);
  assert.ok(cp1 >= 1);
});
  it('raw instant-bust probability ≈ house edge (1%)', () => {
  let rawBusts = 0;
  const N = 20000;
  for (let n = 0; n < N; n++) {
    const u = calculateOutcome('x'.repeat(64), 'c', n);
    const raw = (1 - HOUSE_EDGE.CRASH) / (1 - u);
    if (raw < 1) rawBusts++;
  }
  const rate = rawBusts / N;
  assert.ok(
    Math.abs(rate - HOUSE_EDGE.CRASH) < 0.004,
    `raw bust rate ${rate}, expected ~${HOUSE_EDGE.CRASH}`
  );
});
  it('effective 1.00x rate = the edge plus the floored [1.00,1.01) band', () => {
  let flooredToOne = 0;
  const N = 20000;
  for (let n = 0; n < N; n++) {
    const cp = crash.computeCrashPoint({
      serverSeed: 'x'.repeat(64),
      clientSeed: 'c',
      nonce: n,
      hashedServerSeed: '',
    });
    if (cp <= 1) flooredToOne++;
  }
  const rate = flooredToOne / N;
  const expected = 1 - (1 - HOUSE_EDGE.CRASH) / 1.01;
  assert.ok(
    Math.abs(rate - expected) < 0.005,
    `effective 1.00x rate ${rate}, expected ~${expected}`
  );
});
  it('multiplier grows monotonically with time', () => {
  assert.ok(crash.multiplierAtElapsed(1000) < crash.multiplierAtElapsed(5000));
});

});

describe('Mines', () => {
  it('layout has exactly minesCount mines in range', () => {
  const layout = mines.generateLayout(5, ctx(9));
  assert.equal(layout.minePositions.length, 5);
  layout.minePositions.forEach((p) => assert.ok(p >= 0 && p < 25));
  assert.equal(new Set(layout.minePositions).size, 5);
});
  it('multiplier increases with safe reveals', () => {
  const m1 = mines.multiplierAfter(3, 1);
  const m2 = mines.multiplierAfter(3, 2);
  const m3 = mines.multiplierAfter(3, 3);
  assert.ok(m1 < m2 && m2 < m3);
  assert.equal(mines.multiplierAfter(3, 0), 1);
});
  it('mines layout reproducible from same seed', () => {
  const a = mines.generateLayout(5, ctx(9)).minePositions;
  const b = mines.generateLayout(5, ctx(9)).minePositions;
  assert.deepEqual(a, b);
});

});

describe('Limbo', () => {
  it('deterministic and always >= 1.00', () => {
  const r1 = limbo.play({ targetMultiplier: 2 }, ctx(11));
  const r2 = limbo.play({ targetMultiplier: 2 }, ctx(11));
  assert.deepEqual(r1, r2);
  assert.ok((r1.resultData as any).achievedMultiplier >= 1);
});
  it('win iff achieved >= target; payout is the target, not the achieved value', () => {
  for (let n = 0; n < 500; n++) {
    const r = limbo.play({ targetMultiplier: 3 }, ctx(n));
    const achieved = (r.resultData as any).achievedMultiplier as number;
    assert.equal(r.win, achieved >= 3);
    assert.equal(r.multiplier, r.win ? 3 : 0);
  }
});
  it('rejects out-of-range targets', () => {
  assert.throws(() => limbo.play({ targetMultiplier: 1 }, ctx()));
  assert.throws(() => limbo.play({ targetMultiplier: 2_000_000 }, ctx()));
});
  it('win rate at target T tracks (1-edge)/T', () => {
  const target = 5;
  const N = 20000;
  let wins = 0;
  for (let n = 0; n < N; n++) {
    if (limbo.play({ targetMultiplier: target }, ctx(n)).win) wins++;
  }
  const rate = wins / N;
  const expected = (1 - HOUSE_EDGE.LIMBO) / target;
  assert.ok(Math.abs(rate - expected) < 0.01, `win rate ${rate}, expected ~${expected}`);
});

});

describe('Keno', () => {
  it('drawn numbers are 10 unique tiles in range, deterministic', () => {
  const r1 = keno.play({ picks: [1, 2, 3] }, ctx(4));
  const r2 = keno.play({ picks: [1, 2, 3] }, ctx(4));
  assert.deepEqual(r1, r2);
  const drawn = (r1.resultData as any).drawn as number[];
  assert.equal(drawn.length, 10);
  assert.equal(new Set(drawn).size, 10);
  drawn.forEach((d) => assert.ok(d >= 0 && d < 40));
});
  it('hits = intersection of picks and drawn; multiplier from paytable', () => {
  const picks = [0, 5, 10, 15, 20];
  const r = keno.play({ picks }, ctx(6));
  const drawn = new Set((r.resultData as any).drawn as number[]);
  const expectedHits = picks.filter((p) => drawn.has(p));
  assert.deepEqual((r.resultData as any).hits, expectedHits);
  assert.equal(r.multiplier, KENO_PAYTABLE[5][expectedHits.length]);
});
  it('rejects too many picks, duplicates, and out-of-range picks', () => {
  assert.throws(() => keno.play({ picks: Array.from({ length: 11 }, (_, i) => i) }, ctx()));
  assert.throws(() => keno.play({ picks: [1, 1] }, ctx()));
  assert.throws(() => keno.play({ picks: [40] }, ctx()));
  assert.throws(() => keno.play({ picks: [] }, ctx()));
});
  it('every paytable row is calibrated to the KENO house edge', () => {
  const N = 40;
  const K = 10;
  function comb(n: number, k: number): number {
    if (k < 0 || k > n) return 0;
    let r = 1;
    for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
    return r;
  }
  function prob(picks: number, hits: number): number {
    return (comb(K, hits) * comb(N - K, picks - hits)) / comb(N, picks);
  }
  for (const picks of Object.keys(KENO_PAYTABLE).map(Number)) {
    const table = KENO_PAYTABLE[picks];
    let ev = 0;
    for (const hits of Object.keys(table).map(Number)) {
      ev += prob(picks, hits) * table[hits];
    }
    const target = 1 - HOUSE_EDGE.KENO;
    assert.ok(
      Math.abs(ev - target) < 0.005,
      `picks=${picks} RTP=${ev} target=${target}`
    );
  }
});

});

describe('Slots', () => {
  it('matrix is 5×3 of known symbols and is deterministic', () => {
  const a = slots.spinMatrix(ctx(11));
  const b = slots.spinMatrix(ctx(11));
  assert.deepEqual(a, b);
  assert.equal(a.length, SLOTS_REELS);
  for (const reel of a) {
    assert.equal(reel.length, SLOTS_ROWS);
    for (const cell of reel) assert.ok(SLOTS_SYMBOLS.includes(cell));
  }
  assert.notDeepEqual(a, slots.spinMatrix(ctx(12)));
});
  it('spin() is deterministic and reports the matrix it paid on', () => {
  const r1 = slots.spin({}, ctx(13));
  const r2 = slots.spin({}, ctx(13));
  assert.deepEqual(r1, r2);
  assert.deepEqual((r1.resultData as any).reelMatrix, slots.spinMatrix(ctx(13)));
  assert.equal(r1.win, r1.multiplier > 0);
});
  it('symbolAt covers every symbol and respects weight order', () => {
  const seen = new Set<SlotSymbol>();
  for (let i = 0; i < 20_000; i += 1) seen.add(slots.symbolAt(i / 20_000));
  assert.equal(seen.size, SLOTS_SYMBOLS.length);
  assert.ok(SLOTS_SYMBOLS.includes(slots.symbolAt(0)));
  assert.ok(SLOTS_SYMBOLS.includes(slots.symbolAt(0.999999999)));
});
  it('lines pay left-to-right only, from reel 0', () => {
  const grid = (rows: SlotSymbol[][]): SlotSymbol[][] => rows;
  const hit = grid([
    ['CHERRY', 'BELL', 'CHERRY'],
    ['LEMON', 'BELL', 'LEMON'],
    ['PLUM', 'BELL', 'PLUM'],
    ['PLUM', 'LEMON', 'PLUM'],
    ['PLUM', 'ORANGE', 'PLUM'],
  ]);
  const win = slots.evaluateLine(hit, 1);
  assert.ok(win);
  assert.equal(win!.symbol, 'BELL');
  assert.equal(win!.count, 3);
  assert.equal(win!.multiplier, SLOTS_PAYTABLE.BELL[3]);

  const shifted = grid([
    ['CHERRY', 'LEMON', 'CHERRY'],
    ['LEMON', 'BELL', 'LEMON'],
    ['PLUM', 'BELL', 'PLUM'],
    ['PLUM', 'BELL', 'PLUM'],
    ['PLUM', 'ORANGE', 'PLUM'],
  ]);
  assert.equal(slots.evaluateLine(shifted, 1), null);
});
  it('WILD substitutes, and a pure WILD line pays as WILD', () => {
  const substituted: SlotSymbol[][] = [
    ['x' as SlotSymbol, 'WILD', 'x' as SlotSymbol],
    ['x' as SlotSymbol, 'SEVEN', 'x' as SlotSymbol],
    ['x' as SlotSymbol, 'WILD', 'x' as SlotSymbol],
    ['x' as SlotSymbol, 'SEVEN', 'x' as SlotSymbol],
    ['x' as SlotSymbol, 'CHERRY', 'x' as SlotSymbol],
  ];
  const win = slots.evaluateLine(substituted, 1);
  assert.ok(win);
  assert.equal(win!.symbol, 'SEVEN');
  assert.equal(win!.count, 4);
  assert.equal(win!.multiplier, SLOTS_PAYTABLE.SEVEN[4]);

  const allWild: SlotSymbol[][] = Array.from({ length: SLOTS_REELS }, () => [
    'WILD',
    'WILD',
    'WILD',
  ]);
  const jackpot = slots.evaluateLine(allWild, 0);
  assert.equal(jackpot!.symbol, 'WILD');
  assert.equal(jackpot!.count, 5);
  assert.equal(jackpot!.multiplier, SLOTS_PAYTABLE.WILD[5]);
});
  it('every payline is 5 rows inside the grid, and all 5 are evaluated', () => {
  assert.equal(SLOTS_PAYLINES.length, 5);
  for (const line of SLOTS_PAYLINES) {
    assert.equal(line.length, SLOTS_REELS);
    for (const row of line) assert.ok(row >= 0 && row < SLOTS_ROWS);
  }
  const allWild: SlotSymbol[][] = Array.from({ length: SLOTS_REELS }, () => [
    'WILD',
    'WILD',
    'WILD',
  ]);
  assert.equal(slots.evaluateMatrix(allWild).length, SLOTS_PAYLINES.length);
});
  it('stake multiplier is the line award divided by the payline count', () => {
  const allWild: SlotSymbol[][] = Array.from({ length: SLOTS_REELS }, () => [
    'WILD',
    'WILD',
    'WILD',
  ]);
  const wins = slots.evaluateMatrix(allWild);
  const lineTotal = wins.reduce((sum, w) => sum + w.multiplier, 0);
  assert.equal(lineTotal, SLOTS_PAYTABLE.WILD[5] * SLOTS_PAYLINES.length);
  assert.equal(lineTotal / SLOTS_PAYLINES.length, SLOTS_PAYTABLE.WILD[5]);
});
  it('paytable is calibrated to the configured house edge', () => {
  const total = SLOTS_SYMBOLS.reduce((sum, s) => sum + SLOTS_WEIGHTS[s], 0);
  const p = (s: SlotSymbol) => SLOTS_WEIGHTS[s] / total;
  const n = SLOTS_SYMBOLS.length;

  let rtp = 0;
  const line: SlotSymbol[] = new Array(SLOTS_REELS);
  const walk = (reel: number, prob: number) => {
    if (reel === SLOTS_REELS) {
      const grid = line.map((s) => [s, s, s]);
      const win = slots.evaluateLine(grid, 0);
      if (win) rtp += prob * win.multiplier;
      return;
    }
    for (let i = 0; i < n; i += 1) {
      line[reel] = SLOTS_SYMBOLS[i];
      walk(reel + 1, prob * p(SLOTS_SYMBOLS[i]));
    }
  };
  walk(0, 1);

  const target = 1 - HOUSE_EDGE.SLOTS;
  assert.ok(
    Math.abs(rtp - target) < 0.02,
    `slots RTP=${rtp.toFixed(5)} target=${target}`
  );
});

});

describe('NOWPayments IPN', () => {
  it('canonical payload sorts keys at every depth, as NOWPayments sortObject does', () => {
  const canonical = canonicalIpnPayload({
    payment_status: 'finished',
    actually_paid: 25,
    payment_id: 123,
    nested: { b: 1, a: 2 },
  });
  assert.equal(
    canonical,
    '{"actually_paid":25,"nested":{"a":2,"b":1},"payment_id":123,"payment_status":"finished"}'
  );
  assert.equal(
    canonical,
    canonicalIpnPayload({
      nested: { b: 1, a: 2 },
      payment_id: 123,
      actually_paid: 25,
      payment_status: 'finished',
    })
  );
});
  it('a genuine HMAC-SHA512 signature verifies, a tampered body does not', () => {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET ?? '';
  if (!secret) {
    console.log('    (skipped: NOWPAYMENTS_IPN_SECRET not set)');
    return;
  }
  const body = {
    payment_id: 4522625843,
    payment_status: 'finished',
    pay_address: 'TXk...',
    price_amount: 25,
    price_currency: 'usd',
    order_id: 'dep_user_abc',
  };
  const signature = createHmac('sha512', secret)
    .update(canonicalIpnPayload(body))
    .digest('hex');

  assert.equal(verifyIpnSignature(body, signature), true);
  assert.equal(verifyIpnSignature(body, signature.toUpperCase()), true);
  assert.equal(verifyIpnSignature({ ...body, price_amount: 2500 }, signature), false);
  assert.equal(verifyIpnSignature(body, 'deadbeef'), false);
  assert.equal(verifyIpnSignature(body, ''), false);
  assert.equal(verifyIpnSignature(body, undefined), false);
});
  it('payment_status maps to gateway status; a short payment is not settled', () => {
  assert.equal(mapNowPaymentsStatus('waiting'), 'PENDING');
  assert.equal(mapNowPaymentsStatus('confirming'), 'CONFIRMING');
  assert.equal(mapNowPaymentsStatus('finished'), 'PAID');
  assert.equal(mapNowPaymentsStatus('expired'), 'EXPIRED');
  assert.equal(mapNowPaymentsStatus('failed'), 'FAILED');
  assert.equal(mapNowPaymentsStatus('partially_paid'), 'WRONG_AMOUNT');
  assert.equal(mapNowPaymentsStatus('who_knows'), 'PENDING');
  assert.equal(mapNowPaymentsStatus(undefined), 'PENDING');
});
  it('pay currencies are pinned to a chain', () => {
  assert.equal(payCurrencyFor('USDT'), 'usdttrc20');
  assert.equal(payCurrencyFor('BTC'), 'btc');
  assert.equal(payCurrencyFor('ETH'), 'eth');
  assert.equal(payCurrencyFor('LTC'), 'ltc');
  assert.equal(payCurrencyFor('USDC'), 'usdc');
  assert.equal(payCurrencyFor('SOL'), 'sol');
  assert.equal(payCurrencyFor('TRX'), 'trx');
  assert.equal(payCurrencyFor('BNB'), 'bnbbsc');
  assert.equal(payCurrencyFor('DOGE'), 'doge');
});
  it('withdrawal addresses must match the chosen coin', () => {
  const valid: Record<string, string> = {
    USDT: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
    TRX: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
    BTC: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    ETH: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    USDC: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    BNB: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    LTC: 'ltc1qg82tqcyfwqzxkr4l5ylxa7jgm7qrqyhh0qpmyx',
    SOL: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV',
    DOGE: 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L',
  };
  for (const code of CRYPTO_CODES) {
    assert.ok(isValidCryptoAddress(code, valid[code]), `${code} accepts its own address`);
  }
  assert.equal(isValidCryptoAddress('ETH', valid.BTC), false);
  assert.equal(isValidCryptoAddress('BTC', valid.ETH), false);
  assert.equal(isValidCryptoAddress('USDT', valid.ETH), false);
  assert.equal(isValidCryptoAddress('DOGE', valid.LTC), false);
  assert.equal(isValidCryptoAddress('XRP', valid.ETH), false);
});
  it('every coin has a Binance market except the USDT quote asset', () => {
  for (const spec of CRYPTO_CURRENCIES) {
    if (spec.code === 'USDT') assert.equal(spec.binanceSymbol, null);
    else assert.equal(spec.binanceSymbol, `${spec.code}USDT`);
    assert.ok(spec.payoutDecimals >= 6 && spec.payoutDecimals <= 8);
  }
});
});
