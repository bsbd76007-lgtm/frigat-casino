import type { GameType } from '@frigat/shared';

export {
  BET_LIMITS,
  MINES,
  CHICKEN,
  CRASH,
  ROULETTE_RED,
  ROULETTE_WHEEL_ORDER,
  PLINKO_TABLES,
  PLINKO_ROWS,
  LIMBO,
  KENO_TILE_COUNT,
  KENO_DRAW_COUNT,
  KENO_MAX_PICKS,
  KENO_PAYTABLE,
  SLOTS_REELS,
  SLOTS_ROWS,
  SLOTS_SYMBOLS,
  SLOTS_WEIGHTS,
  SLOTS_PAYTABLE,
  SLOTS_PAYLINES,
  SLOTS_PAYLINE_NAMES,
} from '@frigat/shared';

export const HOUSE_EDGE: Record<GameType, number> = {
  CRASH: 0.025,
  MINES: 0.025,
  ROULETTE: 0,
  COINFLIP: 0.025,
  PLINKO: 0.025,
  DICE: 0.025,
  LIMBO: 0.025,
  KENO: 0.025,
  CHICKEN: 0.06,
  AVIA: 0.06,
  SLOTS: 0.04,
};

export const ROULETTE_PAYOUTS = {
  straight: 36,
  color: 2,
  parity: 2,
  range: 2,
  dozen: 3,
  column: 3,
} as const;
