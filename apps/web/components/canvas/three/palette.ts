export const BOARD = {
  bg: '#1b1f28',
  floor: '#1b1f28',
  floorDeep: '#171a22',
  neutral: '#232834',
  neutralLit: '#2c3240',
  line: '#252a35',
  line2: '#333a48',
  text: '#f2f2f5',
  muted: '#9b9ba6',
  dim: '#6a6a76',
} as const;

export const NEU = {
  dark: 'rgba(5,7,12,.62)',
  light: 'rgba(255,255,255,.075)',
  offset: 4,
} as const;

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

export const FONT = {
  display: "'Unbounded', 'Manrope', ui-sans-serif, system-ui, sans-serif",
  body: "'Manrope', ui-sans-serif, system-ui, -apple-system, sans-serif",
  num: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

export function multiplierColour(multiplier: number): string {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return NEG;
  if (multiplier < 1) return '#8a6a4f';
  if (multiplier < 2) return BOARD.neutralLit;
  if (multiplier < 10) return GOLD_DEEP;
  return GOLD;
}
