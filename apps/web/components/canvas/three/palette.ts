/**
 * The boards' palette and type, mirrored from the design tokens.
 *
 * A 2D context cannot read a custom property — `ctx.fillStyle = 'var(--fg-bg)'`
 * is silently ignored and paints black — so the tokens a board needs are
 * duplicated here as literals. This file is the one place that duplication is
 * allowed to live: if `app/globals.css` moves a token, change it here too.
 *
 * The accent contract from globals.css holds on canvas as well. `ACCENT` is for
 * strokes, glows and small marks; anything that carries white text is filled
 * with `ACCENT_DEEP` or `ACCENT_MID`. `GOLD` is not a second accent — it means
 * reward, so it only ever paints a win.
 */

export const BOARD = {
  /** The stage and the floor share one surface — the neumorphic contract: depth
   *  comes from paired soft shadows, not from the floor being darker. Lifted
   *  well off black, or the light half of the shadow pair has nothing to show
   *  against. Matches --neu-surface in globals.css. */
  bg: '#1b1f28',
  /** The board's own floor, lit and unlit. */
  floor: '#1b1f28',
  floorDeep: '#171a22',
  /** Solids that have no state yet: an unrevealed tile, an idle peg. */
  neutral: '#232834',
  neutralLit: '#2c3240',
  line: '#252a35',
  line2: '#333a48',
  text: '#f2f2f5',
  muted: '#9b9ba6',
  dim: '#6a6a76',
} as const;

/**
 * The soft-shadow pair every raised solid casts. The light half goes up-left
 * and the dark half down-right, matching `faces()`, whose lit flank is the left.
 */
export const NEU = {
  dark: 'rgba(5,7,12,.62)',
  light: 'rgba(255,255,255,.075)',
  /** Offset in CSS pixels; blur is a multiple of it. */
  offset: 4,
} as const;

/**
 * One signature hue per board, taken from the game's poster. Kept to a
 * whisper: it tints the surface and the idle solids and draws the lines, while
 * win, loss and gold keep their meanings unchanged. `surface` is BOARD.bg
 * pulled a few percent toward the hue; `idle` is the colour of a solid that
 * has no state yet.
 */
export interface TableTheme {
  hue: string;
  surface: string;
  idle: string;
  line: string;
}

function table(hue: string, surface: string, idle: string, line: string): TableTheme {
  return { hue, surface, idle, line };
}

export const TABLES = {
  mines: table('#4f8cff', '#1a2030', '#1f2940', '#2c3a58'),
  crash: table('#8b7bff', '#1d1d2e', '#2a2945', '#383660'),
  coinflip: table('#f0b54a', '#22201d', '#33302a', '#47402f'),
  roulette: table('#3fcf86', '#19231f', '#22322b', '#2b463a'),
  keno: table('#38c6f0', '#18222b', '#20323f', '#284557'),
  dice: table('#9a7bff', '#1e1c2c', '#2b2842', '#3a355c'),
  limbo: table('#ff9a4a', '#241e1b', '#362b25', '#4d3a2e'),
  plinko: table('#e05cc0', '#221c26', '#33283a', '#4a3552'),
} as const satisfies Record<string, TableTheme>;

export const ACCENT = '#3b7cff';
export const ACCENT_MID = '#2f6be6';
export const ACCENT_DEEP = '#1f57d6';
export const ON_ACCENT = '#ffffff';

export const GOLD = '#e0b055';
export const GOLD_SOFT = '#f0cb85';
export const GOLD_DEEP = '#b8862f';

export const POS = '#4e9e7a';
export const POS_SOFT = '#86bda6';
export const NEG = '#c25560';

/**
 * The three families from globals.css. Self-hosted, so a family name is all a
 * context needs — and because the boards redraw on every frame, a face that is
 * still loading on the first frame is picked up by a later one.
 */
export const FONT = {
  display: "'Unbounded', 'Manrope', ui-sans-serif, system-ui, sans-serif",
  body: "'Manrope', ui-sans-serif, system-ui, -apple-system, sans-serif",
  /** Anything that ticks or is compared down a column. */
  num: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

/** The colour a multiplier is worth — shared so every board grades alike. */
export function multiplierColour(multiplier: number): string {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return NEG;
  if (multiplier < 1) return '#8a6a4f';
  if (multiplier < 2) return BOARD.neutralLit;
  if (multiplier < 10) return GOLD_DEEP;
  return GOLD;
}
