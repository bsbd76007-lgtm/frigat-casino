/**
 * The chrome every board shares: the ground it sits on and the light above it.
 *
 * Drawn first, so a board's own solids land on a consistent stage. Keeping this
 * out of the individual boards is what makes five different games read as one
 * table rather than five screens that each guessed at a background.
 */

import type { Scene } from './scene';
import { BOARD, ACCENT, type TableTheme } from './palette';
import { drawFloorQuad } from './solids';

export interface BackdropOptions {
  /** World x the floor spans. Defaults to the full stage, generously overhung. */
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
  /** Tint the glow under the board — a win or a bust colours the whole table. */
  glow?: string;
  glowStrength?: number;
  /** The board's signature surface, idle and line colours. */
  theme?: TableTheme;
  /** Grid lines across the floor; 0 draws none. */
  gridRows?: number;
  gridCols?: number;
}

export function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  options: BackdropOptions = {}
): void {
  const {
    x0 = -scene.width,
    x1 = scene.width * 2,
    y0 = 0,
    y1 = 1,
    glow = ACCENT,
    glowStrength = 0.1,
    gridRows = 0,
    gridCols = 0,
    theme,
  } = options;

  // The page behind the board and the floor are one surface — the boards are
  // neumorphic, so a solid stands out by its shadows, not by the floor being
  // a different colour.
  const surface = theme?.surface ?? BOARD.bg;
  ctx.fillStyle = surface;
  ctx.fillRect(0, 0, scene.width, scene.height);
  drawFloorQuad(ctx, scene, x0, x1, y0, y1, surface);

  if (glowStrength > 0) {
    // A flat tint over the table, so a win or a bust still colours it.
    ctx.fillStyle = withAlpha(glow, glowStrength * 0.35);
    ctx.fillRect(0, 0, scene.width, scene.height);
  }

  if (gridCols > 0 || gridRows > 0) {
    ctx.strokeStyle = theme?.line ?? BOARD.line;
    ctx.lineWidth = 1;
    for (let i = 1; i < gridCols; i += 1) {
      const x = x0 + ((x1 - x0) * i) / gridCols;
      const a = scene.project(x, y0);
      const b = scene.project(x, y1);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (let i = 1; i < gridRows; i += 1) {
      const y = y0 + ((y1 - y0) * i) / gridRows;
      const a = scene.project(x0, y);
      const b = scene.project(x1, y);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
}

function withAlpha(hex: string, a: number): string {
  const body = hex.replace('#', '');
  const n = parseInt(body.length === 3 ? body.replace(/(.)/g, '$1$1') : body, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
