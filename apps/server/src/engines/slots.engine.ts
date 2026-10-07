import {
  SLOTS_PAYLINES,
  SLOTS_PAYTABLE,
  SLOTS_REELS,
  SLOTS_ROWS,
  SLOTS_SYMBOLS,
  SLOTS_WEIGHTS,
  type SlotSymbol,
} from '@frigat/shared';
import { floatAt } from './provable';
import type { EngineResult, SeedContext } from '../types/engine.types';

const CUMULATIVE: ReadonlyArray<{ symbol: SlotSymbol; upto: number }> = (() => {
  let running = 0;
  return SLOTS_SYMBOLS.map((symbol) => {
    running += SLOTS_WEIGHTS[symbol];
    return { symbol, upto: running };
  });
})();

const TOTAL_WEIGHT = CUMULATIVE[CUMULATIVE.length - 1].upto;

export function symbolAt(roll: number): SlotSymbol {
  const target = roll * TOTAL_WEIGHT;
  for (const entry of CUMULATIVE) {
    if (target < entry.upto) return entry.symbol;
  }
  return CUMULATIVE[CUMULATIVE.length - 1].symbol;
}

export function spinMatrix(seed: SeedContext): SlotSymbol[][] {
  const matrix: SlotSymbol[][] = [];
  let cursor = 0;
  for (let reel = 0; reel < SLOTS_REELS; reel += 1) {
    const column: SlotSymbol[] = [];
    for (let row = 0; row < SLOTS_ROWS; row += 1) {
      const roll = floatAt(seed.serverSeed, seed.clientSeed, seed.nonce, cursor);
      cursor += 1;
      column.push(symbolAt(roll));
    }
    matrix.push(column);
  }
  return matrix;
}

export interface LineWin {
  lineIndex: number;
  symbol: SlotSymbol;
  count: number;
  multiplier: number;
  cells: Array<[number, number]>;
}

export function evaluateLine(
  matrix: SlotSymbol[][],
  lineIndex: number
): LineWin | null {
  const rows = SLOTS_PAYLINES[lineIndex];
  if (!rows) return null;

  const first = matrix[0][rows[0]];
  let identity: SlotSymbol | null = first === 'WILD' ? null : first;
  let count = 1;

  for (let reel = 1; reel < SLOTS_REELS; reel += 1) {
    const cell = matrix[reel][rows[reel]];
    if (cell === 'WILD') {
      count += 1;
      continue;
    }
    if (identity === null) {
      identity = cell;
      count += 1;
      continue;
    }
    if (cell === identity) {
      count += 1;
      continue;
    }
    break;
  }

  if (count < 3) return null;

  const symbol: SlotSymbol = identity ?? 'WILD';
  const multiplier = SLOTS_PAYTABLE[symbol][count as 3 | 4 | 5];
  if (!multiplier) return null;

  const cells: Array<[number, number]> = [];
  for (let reel = 0; reel < count; reel += 1) cells.push([reel, rows[reel]]);

  return { lineIndex, symbol, count, multiplier, cells };
}

export function evaluateMatrix(matrix: SlotSymbol[][]): LineWin[] {
  const wins: LineWin[] = [];
  for (let line = 0; line < SLOTS_PAYLINES.length; line += 1) {
    const win = evaluateLine(matrix, line);
    if (win) wins.push(win);
  }
  return wins;
}

export function spin(_params: Record<string, unknown>, seed: SeedContext): EngineResult {
  const matrix = spinMatrix(seed);
  const wins = evaluateMatrix(matrix);

  const lineCount = SLOTS_PAYLINES.length;
  const totalLineMultiplier = wins.reduce((sum, win) => sum + win.multiplier, 0);
  const multiplier = Number((totalLineMultiplier / lineCount).toFixed(8));

  return {
    win: multiplier > 0,
    multiplier,
    resultData: {
      reelMatrix: matrix,
      winningLines: wins.map((win) => ({
        lineIndex: win.lineIndex,
        symbol: win.symbol,
        count: win.count,
        multiplier: Number((win.multiplier / lineCount).toFixed(8)),
        cells: win.cells,
      })),
      lineCount,
    },
  };
}
