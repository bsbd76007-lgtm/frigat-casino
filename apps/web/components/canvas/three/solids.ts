import type { Scene, ScreenPoint } from './scene';
import { NEU } from './palette';

export function shade(hex: string, f: number): string {
  const { r, g, b } = parseHex(hex);
  const mix = (c: number) => Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f));
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

export function alpha(hex: string, a: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function mixHex(a: string, b: string, f: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  const at = (p: number, q: number) => Math.round(p + (q - p) * f);
  return `rgb(${at(x.r, y.r)},${at(x.g, y.g)},${at(x.b, y.b)})`;
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  let body = hex.trim().replace('#', '');
  if (body.length === 3) {
    body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
  }
  const n = parseInt(body, 16);
  if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function neu(
  ctx: CanvasRenderingContext2D,
  paint: () => void,
  depth = 1
): void {
  if (depth <= 0) {
    paint();
    return;
  }
  const k = ctx.getTransform().a || 1;
  const d = NEU.offset * depth * k;
  ctx.save();
  ctx.shadowBlur = d * 2.2;
  ctx.shadowColor = NEU.dark;
  ctx.shadowOffsetX = d;
  ctx.shadowOffsetY = d;
  paint();
  ctx.shadowColor = NEU.light;
  ctx.shadowOffsetX = -d;
  ctx.shadowOffsetY = -d;
  paint();
  ctx.restore();
  paint();
}

export function neuInset(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  fill: string,
  depth = 1
): void {
  const k = ctx.getTransform().a || 1;
  const d = NEU.offset * depth * k;
  const ring = new Path2D();
  ring.rect(-1e4, -1e4, 2e4, 2e4);
  ring.addPath(path);

  ctx.save();
  ctx.fillStyle = fill;
  ctx.fill(path);
  ctx.clip(path);
  ctx.fillStyle = '#000';
  ctx.shadowBlur = d * 2;
  ctx.shadowColor = NEU.dark;
  ctx.shadowOffsetX = d;
  ctx.shadowOffsetY = d;
  ctx.fill(ring, 'evenodd');
  ctx.shadowColor = NEU.light;
  ctx.shadowOffsetX = -d;
  ctx.shadowOffsetY = -d;
  ctx.fill(ring, 'evenodd');
  ctx.restore();
}

export function roundRectPath(x: number, y: number, w: number, h: number, r: number): Path2D {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  const p = new Path2D();
  p.moveTo(x + radius, y);
  p.arcTo(x + w, y, x + w, y + h, radius);
  p.arcTo(x + w, y + h, x, y + h, radius);
  p.arcTo(x, y + h, x, y, radius);
  p.arcTo(x, y, x + w, y, radius);
  p.closePath();
  return p;
}

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

export interface FaceColours {
  top: string;
  front: string;
  left: string;
  right: string;
}

export type BoxFace = 'top' | 'front' | 'left' | 'right';

export function faces(base: string, overrides: Partial<FaceColours> = {}): FaceColours {
  return {
    top: shade(base, 0.2),
    front: base,
    left: shade(base, 0.07),
    right: shade(base, -0.3),
    ...overrides,
  };
}

export function poly(
  ctx: CanvasRenderingContext2D,
  points: readonly ScreenPoint[],
  fill: string | CanvasGradient
): void {
  if (points.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

export function drawBox(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  b: Box,
  colours: FaceColours,
  lift = 1
): void {
  const P = scene.project;
  neu(ctx, () => {
    if (b.x0 > scene.vanishX) {
      poly(ctx, [P(b.x0, b.y0, b.z0), P(b.x0, b.y1, b.z0), P(b.x0, b.y1, b.z1), P(b.x0, b.y0, b.z1)], colours.left);
    }
    if (b.x1 < scene.vanishX) {
      poly(ctx, [P(b.x1, b.y0, b.z0), P(b.x1, b.y1, b.z0), P(b.x1, b.y1, b.z1), P(b.x1, b.y0, b.z1)], colours.right);
    }
    poly(ctx, [P(b.x0, b.y1, b.z0), P(b.x1, b.y1, b.z0), P(b.x1, b.y1, b.z1), P(b.x0, b.y1, b.z1)], colours.front);
    poly(ctx, [P(b.x0, b.y0, b.z1), P(b.x1, b.y0, b.z1), P(b.x1, b.y1, b.z1), P(b.x0, b.y1, b.z1)], colours.top);
  }, lift);
}

export function faceQuad(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  face: Exclude<BoxFace, 'top'> | 'top',
  b: Box,
  [a0, a1]: readonly [number, number],
  [c0, c1]: readonly [number, number],
  fill: string | CanvasGradient
): void {
  const P = scene.project;
  if (face === 'top') {
    const x = (a: number) => b.x0 + (b.x1 - b.x0) * a;
    const y = (c: number) => b.y0 + (b.y1 - b.y0) * c;
    poly(ctx, [P(x(a0), y(c0), b.z1), P(x(a1), y(c0), b.z1), P(x(a1), y(c1), b.z1), P(x(a0), y(c1), b.z1)], fill);
    return;
  }
  const z = (c: number) => b.z0 + (b.z1 - b.z0) * c;
  if (face === 'front') {
    const x = (a: number) => b.x0 + (b.x1 - b.x0) * a;
    poly(ctx, [P(x(a0), b.y1, z(c0)), P(x(a1), b.y1, z(c0)), P(x(a1), b.y1, z(c1)), P(x(a0), b.y1, z(c1))], fill);
    return;
  }
  const flank = face === 'left' ? b.x0 : b.x1;
  if (face === 'left' ? flank <= scene.vanishX : flank >= scene.vanishX) return;
  const y = (a: number) => b.y0 + (b.y1 - b.y0) * a;
  poly(ctx, [P(flank, y(a0), z(c0)), P(flank, y(a1), z(c0)), P(flank, y(a1), z(c1)), P(flank, y(a0), z(c1))], fill);
}

export function drawBoxShadow(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  b: Box,
  strength = 1
): void {
  const corners: Array<{ x: number; y: number }> = [];
  for (const x of [b.x0, b.x1]) {
    for (const y of [b.y0, b.y1]) {
      corners.push({ x, y });
      corners.push(scene.shadowOf(x, y, b.z1));
    }
  }
  const outline = hull(corners);
  if (outline.length < 3) return;
  const cx = outline.reduce((s, p) => s + p.x, 0) / outline.length;
  const cy = outline.reduce((s, p) => s + p.y, 0) / outline.length;
  const grow = (k: number) =>
    outline.map((p) => scene.project(cx + (p.x - cx) * k, cy + (p.y - cy) * k));
  poly(ctx, grow(1.12), `rgba(6,6,9,${0.1 * strength})`);
  poly(ctx, grow(0.96), `rgba(6,6,9,${0.24 * strength})`);
}

function hull<T extends { x: number; y: number }>(points: readonly T[]): T[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: T, a: T, b: T) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: T[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: T[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export interface FaceTextOptions {
  fill: string;
  size: number;
  weight?: number | string;
  family?: string;
  offset?: readonly [number, number];
  maxWidthFraction?: number;
}

export function drawFaceText(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  b: Box,
  face: BoxFace,
  text: string,
  options: FaceTextOptions
): void {
  const { fill, size, weight = 700, family, offset = [0, 0], maxWidthFraction = 0.86 } = options;

  let origin: ScreenPoint;
  let acrossEnd: ScreenPoint;
  let downEnd: ScreenPoint;
  const P = scene.project;

  if (face === 'top') {
    origin = P(b.x0, b.y0, b.z1);
    acrossEnd = P(b.x1, b.y0, b.z1);
    downEnd = P(b.x0, b.y1, b.z1);
  } else if (face === 'front') {
    origin = P(b.x0, b.y1, b.z1);
    acrossEnd = P(b.x1, b.y1, b.z1);
    downEnd = P(b.x0, b.y1, b.z0);
  } else {
    const flank = face === 'left' ? b.x0 : b.x1;
    if (face === 'left' ? flank <= scene.vanishX : flank >= scene.vanishX) return;
    origin = P(flank, b.y0, b.z1);
    acrossEnd = P(flank, b.y1, b.z1);
    downEnd = P(flank, b.y0, b.z0);
  }

  const ax = acrossEnd.x - origin.x;
  const ay = acrossEnd.y - origin.y;
  const dx = downEnd.x - origin.x;
  const dy = downEnd.y - origin.y;
  const across = Math.hypot(ax, ay);
  const down = Math.hypot(dx, dy);
  if (across < 1 || down < 1) return;

  ctx.save();
  ctx.transform(ax / across, ay / across, dx / down, dy / down, origin.x, origin.y);
  ctx.fillStyle = fill;
  ctx.font = `${weight} ${size}px ${family ?? 'inherit'}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    text,
    across * (0.5 + offset[0]),
    down * (0.5 + offset[1]),
    across * maxWidthFraction
  );
  ctx.restore();
}

export interface FloorEllipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export function floorEllipse(scene: Scene, x: number, y: number, r: number, z = 0): FloorEllipse {
  const centre = scene.project(x, y, z);
  const side = scene.project(x + r, y, z);
  const depth = scene.project(x, y + r / scene.depthPx, z);
  return {
    cx: centre.x,
    cy: centre.y,
    rx: Math.abs(side.x - centre.x),
    ry: Math.max(0.6, Math.abs(depth.y - centre.y)),
  };
}

export function drawFloorShadow(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  x: number,
  y: number,
  r: number,
  z = 0,
  strength = 1
): void {
  const cast = scene.shadowOf(x, y, z);
  const e = floorEllipse(scene, cast.x, cast.y, r);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(e.cx, e.cy, e.rx * 1.25, e.ry * 1.25, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(6,6,9,${0.12 * strength})`;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(e.cx, e.cy, e.rx * 0.9, e.ry * 0.9, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(6,6,9,${0.26 * strength})`;
  ctx.fill();
  ctx.restore();
}

export function drawCylinder(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  x: number,
  y: number,
  r: number,
  z0: number,
  z1: number,
  base: string,
  lift = 1
): void {
  const bottom = floorEllipse(scene, x, y, r, z0);
  const top = floorEllipse(scene, x, y, r, z1);

  neu(ctx, () => {
    ctx.beginPath();
    ctx.ellipse(bottom.cx, bottom.cy, bottom.rx, bottom.ry, 0, 0, Math.PI);
    ctx.lineTo(top.cx - top.rx, top.cy);
    ctx.ellipse(top.cx, top.cy, top.rx, top.ry, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fillStyle = base;
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(top.cx, top.cy, top.rx, top.ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = shade(base, 0.22);
    ctx.fill();
  }, lift);
}

export function drawSphere(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  x: number,
  y: number,
  z: number,
  r: number,
  base: string,
  lift = 1
): void {
  const centre = scene.project(x, y, z);
  const rr = Math.max(1, r * scene.scale(y));
  neu(ctx, () => {
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, rr, 0, Math.PI * 2);
    ctx.fillStyle = base;
    ctx.fill();
  }, lift);
}

export function drawFloorQuad(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  fill: string | CanvasGradient,
  z = 0
): void {
  const P = scene.project;
  poly(ctx, [P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)], fill);
}
