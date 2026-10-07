import { PIXEL_SIZE } from './config';

export const PAL = {
  skyFar: '#9fd3e8',
  skyMid: '#7fbcd9',
  skyNear: '#63a3c7',

  grassNear: '#4f9445',
  grassMid: '#5ea54e',
  grassFar: '#7bbb62',
  grassHaze: '#9ccb7e',

  roadNear: '#3a3f52',
  roadMid: '#464c61',
  roadFar: '#565d74',
  roadHaze: '#6b7389',
  roadBand: '#414759',

  paint: '#eef3f7',
  paintDim: '#c3ccd6',
  edgeLine: '#e8b74a',

  kerbTop: '#c2c8d2',
  kerbFace: '#8d94a1',
  kerbDark: '#6d7482',

  coverRim: '#5b6474',
  coverFace: '#3d4453',
  coverDeep: '#2b313d',
  coverLive: '#c9992f',
  coverLiveRim: '#f0c14b',
  coverDone: '#3c5a49',

  featherLit: '#ffffff',
  feather: '#e6ecf2',
  featherShade: '#b9c4d1',
  comb: '#e0454b',
  combDark: '#a92b32',
  beak: '#f2a52c',
  beakDark: '#c77c12',
  eye: '#1b2130',
  outline: '#3b4453',

  shadow: 'rgba(10,14,22,.34)',
  shadowSoft: 'rgba(10,14,22,.18)',
  night: '#1b2130',
} as const;

export const CAR_PALETTES = [
  { roof: '#f2706f', shell: '#d93f47', side: '#a6272f', dark: '#7c1b22' },
  { roof: '#63b0f5', shell: '#2f7fd4', side: '#1f5ca3', dark: '#153f73' },
  { roof: '#ffd15c', shell: '#f0a91f', side: '#c07d0d', dark: '#8c5a08' },
  { roof: '#7fd9a8', shell: '#3aa873', side: '#247a52', dark: '#17573a' },
  { roof: '#f6f8fb', shell: '#cdd5e0', side: '#9ba5b5', dark: '#6f7684' },
  { roof: '#c39bf0', shell: '#8c5cd0', side: '#6a3fa8', dark: '#4a2a78' },
] as const;

export type CarPalette = (typeof CAR_PALETTES)[number];

export const snap = (n: number): number =>
  PIXEL_SIZE > 1 ? Math.round(n / PIXEL_SIZE) * PIXEL_SIZE : n;

export function px(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string
): void {
  const x0 = snap(x);
  const y0 = snap(y);
  const x1 = Math.max(x0 + PIXEL_SIZE, snap(x + w));
  const y1 = Math.max(y0 + PIXEL_SIZE, snap(y + h));
  ctx.fillStyle = fill;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

export function pxQuad(
  ctx: CanvasRenderingContext2D,
  pts: ReadonlyArray<{ x: number; y: number }>,
  fill: string
): void {
  ctx.beginPath();
  ctx.moveTo(snap(pts[0].x), snap(pts[0].y));
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(snap(pts[i].x), snap(pts[i].y));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

export interface Sprite {
  readonly rows: readonly string[];
  readonly key: Readonly<Record<string, string>>;
}

export const spriteWidth = (s: Sprite): number => s.rows[0]?.length ?? 0;
export const spriteHeight = (s: Sprite): number => s.rows.length;

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: Sprite,
  cx: number,
  footY: number,
  drawH: number,
  options: { flip?: boolean; tint?: Record<string, string> } = {}
): void {
  const rows = sprite.rows;
  const cols = spriteWidth(sprite);
  if (!cols) return;

  const unit = Math.max(PIXEL_SIZE, snap(drawH / rows.length));
  const w = cols * unit;
  const h = rows.length * unit;
  const left = snap(cx - w / 2);
  const top = snap(footY - h);

  const key = options.tint ? { ...sprite.key, ...options.tint } : sprite.key;

  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    let c = 0;
    while (c < cols) {
      const ch = row[options.flip ? cols - 1 - c : c] ?? '.';
      if (ch === '.') {
        c += 1;
        continue;
      }
      let run = 1;
      while (c + run < cols && (row[options.flip ? cols - 1 - c - run : c + run] ?? '.') === ch) {
        run += 1;
      }
      const fill = key[ch];
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(left + c * unit, top + r * unit, run * unit, unit);
      }
      c += run;
    }
  }
}

const BIRD_KEY = {
  K: PAL.outline,
  W: PAL.featherLit,
  w: PAL.feather,
  s: PAL.featherShade,
  R: PAL.comb,
  r: PAL.combDark,
  B: PAL.beak,
  b: PAL.beakDark,
  E: PAL.eye,
} as const;

export const CHICKEN_IDLE: Sprite = {
  key: BIRD_KEY,
  rows: [
    '..........rRr...',
    '.........rRRRr..',
    '.........rRRRr..',
    '.........KKKKK..',
    '........KKWWWKK.',
    '........KWWWWWK.',
    '........KWWEWWKB',
    '.......KKWWWWWKB',
    '..KK...KWWWWWWK.',
    '.KssK.KKWWWWWWK.',
    '.KsssKKWWWWWWWK.',
    '.KsssWWWWWWWWWK.',
    '..KWWWWWWWWWWWK.',
    '..KWwsWWWWWwsWK.',
    '...KKKKKKKKKKK..',
    '.....BB...BB....',
    '....BBB...BBB...',
  ],
};

export const CHICKEN_STEP: Sprite = {
  key: BIRD_KEY,
  rows: [
    '................',
    '..........rRr...',
    '.........rRRRr..',
    '.........rRRRr..',
    '.........KKKKK..',
    '........KKWWWKK.',
    '........KWWWWWK.',
    '........KWWEWWKB',
    '.KK....KKWWWWWKB',
    'KssK..KKWWWWWWK.',
    'KsssKKKWWWWWWWK.',
    '.KssWWWWWWWWWWK.',
    '..KWWWWWWWWWWWK.',
    '..KWwsWWWWWwsWK.',
    '...KKKKKKKKKKK..',
    '......BB.BB.....',
    '.....BBB.BBB....',
  ],
};

export function chickenFrame(timeSeconds: number): Sprite {
  return Math.floor(timeSeconds * 4.6) % 2 === 0 ? CHICKEN_IDLE : CHICKEN_STEP;
}
