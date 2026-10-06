/**
 * Chicken Road — canvas drawing.
 *
 * Pure rendering: every function here takes a context, a `View` (the camera,
 * see view.ts) and world coordinates, and draws. None of them decide anything
 * about the round, which is what keeps the outcome logic in one place and this
 * file safe to tune by eye.
 *
 * The scene is pseudo-3D: the road is a plane seen in perspective, cars and
 * barriers are extruded boxes standing on it, and every object casts a shadow
 * from the one point light in `view.ts`. Faces are shaded by which way they
 * point relative to that light, so the lighting and the shadows agree.
 *
 * The art is pixel art, which constrains how all of that is painted. Colours
 * come from the fixed palette in `pixel.ts` and depth is carried by *steps*
 * along a ramp rather than by a gradient: a canvas gradient resolved into the
 * board's quarter-size buffer comes back as banding noise, so the bands are
 * drawn deliberately instead of falling out of a quantised ramp. Edges snap to
 * the art grid so nothing shimmers as it moves. See `pixel.ts`.
 */

import type { KeyedSprite } from '@/lib/spriteMask';

import type { View } from './view';
import { PIXEL_SIZE } from './config';
import {
  CAR_PALETTES,
  PAL,
  chickenFrame,
  drawSprite,
  px,
  pxQuad,
  snap,
  type CarPalette,
} from './pixel';

export function randomCarColour(): CarColour {
  return CAR_COLOURS[Math.floor(Math.random() * CAR_COLOURS.length)] ?? CAR_COLOURS[0];
}

// ─────────────────────────────────────────────
// Sizes and palette
// ─────────────────────────────────────────────

/**
 * Both grids are sized in abstract units and scaled at draw time. The car's
 * `len` runs *along* its lane and `width` across it; `body` and `cabin` are its
 * heights, so a car is a box on a box.
 */
export const CAR_UNITS = { len: 8, width: 5, body: 2.1, cabin: 1.7 } as const;
export const CHICKEN_UNITS = { w: 8, h: 7 } as const;

/**
 * Liveries, straight from the pixel palette. Four flat steps each — the lit
 * roof, the shell, the shaded flank and the dark trim — so a car needs no
 * computed shading at draw time and resolves to exactly four colours.
 *
 * `shade()` is gone from the car path with them: a continuously lightened or
 * darkened fill is a fifth, sixth and seventh colour that the palette never
 * agreed to, and at this size it read as noise along the panel edges.
 */
export const CAR_COLOURS = CAR_PALETTES;

export type CarColour = CarPalette;

/** Lightens (f > 0) or darkens (f < 0) a #rrggbb colour. */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) =>
    Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `rgb(${r},${g},${b})`;
}

// ─────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────

type Pt = { x: number; y: number };

function poly(ctx: CanvasRenderingContext2D, pts: readonly Pt[], fill: string | CanvasGradient) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Convex hull (monotone chain) — the outline of a shadow from its corners. */
function hull(points: Array<{ u: number; t: number }>): Array<{ u: number; t: number }> {
  const pts = [...points].sort((a, b) => a.u - b.u || a.t - b.t);
  const cross = (o: typeof pts[0], a: typeof pts[0], b: typeof pts[0]) =>
    (a.u - o.u) * (b.t - o.t) - (a.t - o.t) * (b.u - o.u);
  const lower: typeof pts = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: typeof pts = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

interface Box {
  u0: number;
  u1: number;
  t0: number;
  t1: number;
  h0: number;
  h1: number;
}

/**
 * Ground shadow of a box: the hull of its footprint and of its top face cast
 * through the light. Two passes — a wide faint one and the core — stand in for
 * a soft edge without a blur filter, which not every canvas supports.
 */
export function drawBoxShadow(ctx: CanvasRenderingContext2D, v: View, b: Box, strength = 1) {
  const corners: Array<{ u: number; t: number }> = [];
  for (const u of [b.u0, b.u1]) {
    for (const t of [b.t0, b.t1]) {
      corners.push({ u, t });
      corners.push(v.shadowOf(u, t, b.h1));
    }
  }
  const outline = hull(corners);
  const cu = outline.reduce((s, p) => s + p.u, 0) / outline.length;
  const ct = outline.reduce((s, p) => s + p.t, 0) / outline.length;
  /** The outline scaled about its centre — the faint pass is a size up. */
  const grow = (k: number) =>
    outline.map((p) => v.project(cu + (p.u - cu) * k, ct + (p.t - ct) * k));
  poly(ctx, grow(1.1), `rgba(10,14,22,${0.1 * strength})`);
  poly(ctx, grow(0.96), `rgba(10,14,22,${0.22 * strength})`);
}

/**
 * An extruded box. Only faces turned toward the camera are drawn — the top,
 * the near face, and whichever flank faces the vanishing line — in back-to-front
 * order, so no depth buffer is needed. `left` is the lit flank: the light is out
 * to the left of the road.
 */
function drawBox(
  ctx: CanvasRenderingContext2D,
  v: View,
  b: Box,
  colours: { top: string; front: string; left: string; right: string }
) {
  const P = (u: number, t: number, h: number) => v.project(u, t, h);
  if (b.u0 > v.vanishX) {
    poly(ctx, [P(b.u0, b.t0, b.h0), P(b.u0, b.t1, b.h0), P(b.u0, b.t1, b.h1), P(b.u0, b.t0, b.h1)], colours.left);
  }
  if (b.u1 < v.vanishX) {
    poly(ctx, [P(b.u1, b.t0, b.h0), P(b.u1, b.t1, b.h0), P(b.u1, b.t1, b.h1), P(b.u1, b.t0, b.h1)], colours.right);
  }
  poly(ctx, [P(b.u0, b.t1, b.h0), P(b.u1, b.t1, b.h0), P(b.u1, b.t1, b.h1), P(b.u0, b.t1, b.h1)], colours.front);
  poly(ctx, [P(b.u0, b.t0, b.h1), P(b.u1, b.t0, b.h1), P(b.u1, b.t1, b.h1), P(b.u0, b.t1, b.h1)], colours.top);
}

/** Overpass geometry, in lane widths: the clearance under the deck and its thickness. */
const OVERPASS = { depth: 0.07, clearance: 0.62, deck: 0.2 } as const;

/** Screen y of the underside of the overpass deck — cars are clipped below it. */
export function overpassClipY(v: View, tunnelY: number): number {
  return v.project(0, tunnelY, v.laneW * OVERPASS.clearance).y;
}

/**
 * The overpass that hides the traffic. `mouth` paints the dark opening on the
 * road (drawn on the ground layer, before any car); `deck` paints the concrete
 * span over it (drawn in depth order, so barriers in front still overlap it).
 * Flat colours only.
 */
export function drawOverpass(
  ctx: CanvasRenderingContext2D,
  v: View,
  tunnelY: number,
  part: 'mouth' | 'deck'
) {
  const span = v.width * 4;
  const t1 = tunnelY;
  const t0 = tunnelY - OVERPASS.depth;
  const h0 = v.laneW * OVERPASS.clearance;
  const h1 = h0 + v.laneW * OVERPASS.deck;
  const P = (u: number, t: number, h: number) => v.project(u, t, h);

  if (part === 'mouth') {
    // Everything under the deck, from the far side down to the opening.
    poly(
      ctx,
      [P(-span, t0, 0), P(span, t0, 0), P(span, t1, 0), P(span, t1, h0), P(-span, t1, h0), P(-span, t1, 0)],
      PAL.night
    );
    poly(ctx, [P(-span, t0, 0), P(span, t0, 0), P(span, t0, h1), P(-span, t0, h1)], PAL.night);
    return;
  }

  drawBox(ctx, v, { u0: -span, u1: span, t0, t1, h0, h1 }, {
    top: PAL.kerbTop,
    front: PAL.kerbFace,
    left: PAL.kerbFace,
    right: PAL.kerbDark,
  });
  // A painted stripe along the face, and a rail on top.
  poly(
    ctx,
    [P(-span, t1, h0 + (h1 - h0) * 0.42), P(span, t1, h0 + (h1 - h0) * 0.42), P(span, t1, h0 + (h1 - h0) * 0.58), P(-span, t1, h0 + (h1 - h0) * 0.58)],
    PAL.edgeLine
  );
  poly(
    ctx,
    [P(-span, t1, h1), P(span, t1, h1), P(span, t1, h1 + v.laneW * 0.05), P(-span, t1, h1 + v.laneW * 0.05)],
    PAL.kerbDark
  );
}

/** A quad lying on one face of a box, inset by fractions — windows, lamps. */
function faceQuad(
  ctx: CanvasRenderingContext2D,
  v: View,
  face: 'front' | 'left' | 'right',
  b: Box,
  [a0, a1]: readonly [number, number],
  [z0, z1]: readonly [number, number],
  fill: string
) {
  const h = (z: number) => b.h0 + (b.h1 - b.h0) * z;
  if (face === 'front') {
    const u = (a: number) => b.u0 + (b.u1 - b.u0) * a;
    poly(ctx, [v.project(u(a0), b.t1, h(z0)), v.project(u(a1), b.t1, h(z0)), v.project(u(a1), b.t1, h(z1)), v.project(u(a0), b.t1, h(z1))], fill);
    return;
  }
  const uu = face === 'left' ? b.u0 : b.u1;
  if (face === 'left' ? uu <= v.vanishX : uu >= v.vanishX) return;
  const t = (a: number) => b.t0 + (b.t1 - b.t0) * a;
  poly(ctx, [v.project(uu, t(a0), h(z0)), v.project(uu, t(a1), h(z0)), v.project(uu, t(a1), h(z1)), v.project(uu, t(a0), h(z1))], fill);
}

// ─────────────────────────────────────────────
// Cars
// ─────────────────────────────────────────────

/** A car's two boxes, from its lane centre `u`, row `t` and sprite scale. */
export function carBoxes(u: number, t: number, scale: number, depthPx: number) {
  const halfW = (CAR_UNITS.width * scale) / 2;
  const halfL = (CAR_UNITS.len * scale) / depthPx / 2;
  const bodyH = CAR_UNITS.body * scale;
  const body: Box = { u0: u - halfW, u1: u + halfW, t0: t - halfL, t1: t + halfL, h0: scale * 0.55, h1: bodyH };
  const cabin: Box = {
    u0: u - halfW * 0.8,
    u1: u + halfW * 0.8,
    t0: t - halfL * 0.62,
    t1: t + halfL * 0.2,
    h0: bodyH,
    h1: bodyH + CAR_UNITS.cabin * scale,
  };
  return { body, cabin };
}

export function drawCarShadow(ctx: CanvasRenderingContext2D, v: View, u: number, t: number, scale: number) {
  const { body, cabin } = carBoxes(u, t, scale, v.depthPx);
  drawBoxShadow(ctx, v, { ...body, h1: cabin.h1 * 0.92 }, 0.8);
}

/**
 * A car driving down its lane toward the camera: a body box on four wheels,
 * a glasshouse set back on top, lamps on the nose.
 */
export function drawCar3D(
  ctx: CanvasRenderingContext2D,
  v: View,
  u: number,
  t: number,
  scale: number,
  colour: CarColour
) {
  const { body, cabin } = carBoxes(u, t, scale, v.depthPx);

  // Wheels first: four dark blocks under the body, only their outer faces and
  // the front pair's tread ever show.
  const wheelW = scale * 0.75;
  const wheelL = (scale * 1.6) / v.depthPx;
  for (const wt of [body.t0 + (body.t1 - body.t0) * 0.2, body.t1 - (body.t1 - body.t0) * 0.2]) {
    for (const wu of [body.u0 - wheelW * 0.15, body.u1 - wheelW * 0.85]) {
      drawBox(ctx, v, { u0: wu, u1: wu + wheelW, t0: wt - wheelL / 2, t1: wt + wheelL / 2, h0: 0, h1: scale * 1.15 }, {
        top: '#1f2530',
        front: '#12161f',
        left: '#1a1f29',
        right: '#0d1017',
      });
    }
  }

  drawBox(ctx, v, body, {
    top: colour.roof,
    front: colour.shell,
    left: colour.shell,
    right: colour.side,
  });

  // Nose: grille band, then the two headlamps either side of it. Flat opaque
  // colours rather than translucent ones — an alpha fill over a banded road
  // takes its colour from whichever band it lands on, so the same lamp came
  // out a different shade at each end of the lane.
  faceQuad(ctx, v, 'front', body, [0.3, 0.7], [0.18, 0.5], PAL.night);
  for (const [a0, a1] of [[0.06, 0.26], [0.74, 0.94]] as const) {
    faceQuad(ctx, v, 'front', body, [a0, a1], [0.38, 0.72], '#fff4c2');
  }
  // Bumper, a darker strip along the bottom of the nose.
  faceQuad(ctx, v, 'front', body, [0, 1], [0, 0.16], colour.dark);
  // Door line down the visible flank.
  for (const face of ['left', 'right'] as const) {
    faceQuad(ctx, v, face, body, [0.46, 0.48], [0.15, 0.95], colour.dark);
  }

  drawBox(ctx, v, cabin, {
    top: colour.roof,
    front: PAL.night,
    left: colour.shell,
    right: colour.side,
  });
  // Glass: windscreen across the near face, side windows along the flanks.
  // Two fixed blues from the palette, not alpha over the livery.
  faceQuad(ctx, v, 'front', cabin, [0.08, 0.92], [0.08, 0.88], '#8fb6dc');
  for (const face of ['left', 'right'] as const) {
    faceQuad(ctx, v, face, cabin, [0.12, 0.88], [0.15, 0.85], '#2a3b57');
  }
  // No roof glint. A translucent triangle across the top face is a soft edge
  // on a board that has none, and it broke the car's four-colour budget.
}

// ─────────────────────────────────────────────
// Road
// ─────────────────────────────────────────────

export interface RoadSpec {
  /** First lane of asphalt; lane 0 is the grass verge the chicken starts on. */
  firstLane: number;
  /** Last lane of the road; the finish verge begins after it. */
  lastLane: number;
}

/** Ground, asphalt, kerb, lane markings and the finish strip. */
export function drawRoad(ctx: CanvasRenderingContext2D, v: View, road: RoadSpec) {
  const { width, height } = v;

  // ── Sky over the far end — one flat colour ──
  const skyFoot = v.project(0, 0).y;
  px(ctx, 0, 0, width, skyFoot + 2, PAL.skyMid);

  // ── Grass — one flat colour under the whole stage; the road is laid over it.
  // Drawn as a quad in world space so its far edge meets the sky along the
  // road's own horizon.
  const spread = width * 4;
  pxQuad(
    ctx,
    [v.project(-spread, -0.2), v.project(spread, -0.2), v.project(spread, 1.25), v.project(-spread, 1.25)],
    PAL.grassMid
  );

  const roadL = v.laneLeft(road.firstLane);
  const roadR = v.laneLeft(road.lastLane + 1);
  const far = -0.15;
  const near = 1.2;

  // ── Asphalt — one flat colour, every other lane one shade off so the lanes
  // stay countable at the far end where the dashes thin out.
  pxQuad(
    ctx,
    [v.project(roadL, far), v.project(roadR, far), v.project(roadR, near), v.project(roadL, near)],
    PAL.roadMid
  );
  for (let lane = road.firstLane; lane <= road.lastLane; lane += 2) {
    const l0 = v.laneLeft(lane);
    const l1 = l0 + v.laneW;
    pxQuad(
      ctx,
      [v.project(l0, far), v.project(l1, far), v.project(l1, near), v.project(l0, near)],
      PAL.roadBand
    );
  }

  // Lane dividers: dashes laid on the asphalt, so they foreshorten with it.
  const lineW = Math.max(2, v.laneW * 0.022);
  for (let lane = road.firstLane + 1; lane <= road.lastLane; lane += 1) {
    const u = v.laneLeft(lane);
    for (let t = -0.1; t < 1.15; t += 0.1) {
      const t1 = t + 0.055;
      pxQuad(
        ctx,
        [v.project(u - lineW / 2, t), v.project(u + lineW / 2, t), v.project(u + lineW / 2, t1), v.project(u - lineW / 2, t1)],
        PAL.paint
      );
    }
  }

  // Kerbs: a raised concrete lip along both edges of the asphalt, with the
  // yellow edge line painted along its top.
  const kerbW = v.laneW * 0.08;
  const kerbH = Math.max(4, v.laneW * 0.05);
  for (const [u0, u1] of [[roadL - kerbW, roadL], [roadR, roadR + kerbW]] as const) {
    drawBox(ctx, v, { u0, u1, t0: far, t1: near, h0: 0, h1: kerbH }, {
      top: PAL.kerbTop,
      front: PAL.kerbFace,
      left: PAL.kerbFace,
      right: PAL.kerbDark,
    });
    const mid = (u0 + u1) / 2;
    poly(
      ctx,
      [v.project(mid - kerbW * 0.22, far, kerbH), v.project(mid + kerbW * 0.22, far, kerbH), v.project(mid + kerbW * 0.22, near, kerbH), v.project(mid - kerbW * 0.22, near, kerbH)],
      PAL.edgeLine
    );
  }

  // Finish strip on the far verge: a chequer laid on the grass past the kerb.
  const f0 = roadR + kerbW * 1.6;
  const cellU = v.laneW * 0.16;
  const cellT = 0.06;
  for (let col = 0; col < 2; col += 1) {
    for (let row = 0; row * cellT < 1.2; row += 1) {
      const u0 = f0 + col * cellU;
      const t0 = -0.1 + row * cellT;
      pxQuad(
        ctx,
        [v.project(u0, t0), v.project(u0 + cellU, t0), v.project(u0 + cellU, t0 + cellT), v.project(u0, t0 + cellT)],
        (col + row) % 2 === 0 ? PAL.paint : PAL.night
      );
    }
  }
}

/**
 * Atmosphere — deliberately empty now. The stepped haze bands that used to sit
 * over the far end read as a gradient; the board is flat colour throughout.
 * Kept as a hook so the render order in ChickenRoad.tsx does not change.
 */
export function drawAtmosphere(_ctx: CanvasRenderingContext2D, _v: View) {}

// ─────────────────────────────────────────────
// Manhole covers — the multiplier ladder
// ─────────────────────────────────────────────

export type CoverState = 'ahead' | 'next' | 'stand' | 'cleared';

/**
 * A cast-iron cover set into the asphalt at the chicken's row, carrying the
 * lane's multiplier and the odds of getting there. The disc lies on the road
 * and foreshortens with it; the numbers stand up off it, facing the camera,
 * because text laid flat at this angle would be unreadable.
 */
export function drawCover(
  ctx: CanvasRenderingContext2D,
  v: View,
  u: number,
  t: number,
  radius: number,
  state: CoverState,
  multiplier: string,
  chance: string,
  timeSeconds: number,
  /** Below the unlock lane: it counts toward the ladder but cannot be banked. */
  locked = false
) {
  /**
   * A cover is an octagon, not a circle.
   *
   * Thirty-six segments resolved into the board's quarter-size buffer produced
   * a wobbling, half-covered edge that changed shape as the camera panned —
   * the one place the old board most obviously read as "shrunk" rather than
   * "drawn". Eight snapped segments land on the grid and hold still, and at
   * this size an octagon reads as a disc anyway.
   */
  const ring = (r: number) => {
    const pts: Pt[] = [];
    for (let i = 0; i < 8; i += 1) {
      // Half a step of rotation puts a flat, not a vertex, at top and bottom.
      const a = ((i + 0.5) / 8) * Math.PI * 2;
      pts.push(v.project(u + Math.cos(a) * r, t + (Math.sin(a) * r) / v.depthPx));
    }
    return pts;
  };

  ctx.save();
  if (state === 'cleared') ctx.globalAlpha = 0.55;

  if (state === 'next') {
    // The lane in play pulses so the eye finds it without reading. Stepped to
    // three states rather than eased, so the halo is always a flat colour.
    const step = Math.floor(timeSeconds * 4) % 3;
    pxQuad(ctx, ring(radius * (1.3 + step * 0.06)), PAL.coverLiveRim);
  }

  // Recess, rim and face: three rings, dark to light, for a cast edge.
  pxQuad(ctx, ring(radius * 1.06), PAL.coverDeep);
  pxQuad(ctx, ring(radius), state === 'next' ? PAL.coverLive : PAL.coverRim);
  pxQuad(ctx, ring(radius * 0.8), state === 'cleared' ? PAL.coverDone : PAL.coverFace);

  // Tread: three bars across the face, each a snapped block. The old five
  // hairlines at 8% white were under one art pixel wide and vanished.
  const barW = radius * 0.1;
  const barT = (radius * 0.5) / v.depthPx;
  for (let i = -1; i <= 1; i += 1) {
    const cu = u + i * radius * 0.34;
    pxQuad(
      ctx,
      [
        v.project(cu - barW, t - barT),
        v.project(cu + barW, t - barT),
        v.project(cu + barW, t + barT),
        v.project(cu - barW, t + barT),
      ],
      state === 'next' ? PAL.coverLiveRim : PAL.coverRim
    );
  }

  // No bolt heads. Eight sub-pixel discs around the rim cost eight arcs a
  // cover per frame and never resolved to more than a speckle of grey.

  ctx.restore();
}

/**
 * A cover's multiplier and win chance.
 *
 * Split out of `drawCover` so it can be drawn in the board's crisp overlay
 * pass. The board renders its world at a quarter resolution for the pixel look,
 * and a 12px label resolved into that buffer comes back as three pixels of
 * mush — the ladder is the one thing on this board a player has to read exactly.
 */
export function drawCoverLabels(
  ctx: CanvasRenderingContext2D,
  v: View,
  u: number,
  t: number,
  radius: number,
  state: CoverState,
  multiplier: string,
  chance: string,
  locked = false
) {
  // The chicken stands on its own cover and hides it; everything else labels.
  if (state === 'stand') return;

  ctx.save();
  if (state === 'cleared') ctx.globalAlpha = 0.55;

  const c = v.project(u, t);
  const s = v.scale(t);
  const big = Math.max(10, radius * 0.46 * s);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.font = `900 ${big}px ui-sans-serif, system-ui, sans-serif`;
  ctx.lineWidth = Math.max(2, big * 0.22);
  ctx.strokeStyle = 'rgba(8,12,18,.85)';
  ctx.strokeText(multiplier, c.x, c.y - big * 0.28);
  ctx.fillStyle = locked
    ? '#94a3b8'
    : state === 'next'
      ? '#fde68a'
      : state === 'cleared'
        ? '#86efac'
        : '#ffffff';
  ctx.fillText(multiplier, c.x, c.y - big * 0.28);
  const small = big * 0.62;
  ctx.font = `800 ${small}px ui-sans-serif, system-ui, sans-serif`;
  ctx.lineWidth = Math.max(2, small * 0.24);
  ctx.strokeText(chance, c.x, c.y + big * 0.62);
  ctx.fillStyle = 'rgba(226,232,240,.9)';
  ctx.fillText(chance, c.x, c.y + big * 0.62);
  ctx.restore();
}

// ─────────────────────────────────────────────
// Barriers
// ─────────────────────────────────────────────

/**
 * A boom barrier at the kerb end of a lane. `closed` runs 0 (arm straight up)
 * to 1 (arm down across the lane, holding its traffic). The post and the arm
 * both cast shadows, so the arm's shadow sweeps across the asphalt as it drops.
 */
export function barrierGeometry(v: View, lane: number, t: number, closed: number) {
  const post = { u: v.laneLeft(lane) + v.laneW * 0.06, w: v.laneW * 0.07, h: v.laneW * 0.34 };
  const pivotH = post.h * 0.86;
  const angle = (Math.PI / 2) * (1 - closed);
  const length = v.laneW * 0.86;
  const tip = { u: post.u + post.w / 2 + Math.cos(angle) * length, h: pivotH + Math.sin(angle) * length };
  const postBox: Box = { u0: post.u, u1: post.u + post.w, t0: t - 0.012, t1: t + 0.012, h0: 0, h1: post.h };
  return { postBox, pivot: { u: post.u + post.w / 2, h: pivotH }, tip, t };
}

export function drawBarrierShadow(ctx: CanvasRenderingContext2D, v: View, lane: number, t: number, closed: number) {
  const g = barrierGeometry(v, lane, t, closed);
  drawBoxShadow(ctx, v, g.postBox, 0.8);
  const a = v.shadowOf(g.pivot.u, t, g.pivot.h);
  const b = v.shadowOf(g.tip.u, t, g.tip.h);
  const pa = v.project(a.u, a.t);
  const pb = v.project(b.u, b.t);
  ctx.strokeStyle = 'rgba(10,14,22,.28)';
  ctx.lineWidth = Math.max(2, v.laneW * 0.045 * v.scale(t));
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pa.x, pa.y);
  ctx.lineTo(pb.x, pb.y);
  ctx.stroke();
}

export function drawBarrier(ctx: CanvasRenderingContext2D, v: View, lane: number, t: number, closed: number) {
  const g = barrierGeometry(v, lane, t, closed);
  drawBox(ctx, v, g.postBox, {
    top: PAL.kerbTop,
    front: PAL.kerbFace,
    left: PAL.kerbFace,
    right: PAL.kerbDark,
  });

  // The arm: red and white bands along its length. Drawn as snapped quads
  // rather than as a stroked line — a stroke is centred on its path and lands
  // on half-pixels at both ends, which left every band with a soft edge and a
  // different apparent width depending on where the arm had swung to.
  const width = Math.max(PIXEL_SIZE, v.laneW * 0.05 * v.scale(t));
  const bands = 7;
  for (let i = 0; i < bands; i += 1) {
    const f0 = i / bands;
    const f1 = (i + 1) / bands;
    const at = (f: number) => ({
      u: g.pivot.u + (g.tip.u - g.pivot.u) * f,
      h: g.pivot.h + (g.tip.h - g.pivot.h) * f,
    });
    const a = at(f0);
    const b = at(f1);
    // Give the band thickness across the arm by offsetting in height, which is
    // the axis the arm is thin on whichever way it has swung.
    const half = (width / 2) / v.scale(t);
    pxQuad(
      ctx,
      [
        v.project(a.u, t, a.h + half),
        v.project(b.u, t, b.h + half),
        v.project(b.u, t, b.h - half),
        v.project(a.u, t, a.h - half),
      ],
      i % 2 === 0 ? PAL.comb : PAL.paint
    );
  }
  // Lamp on the tip, lit once the arm is down. A snapped block, not an arc.
  if (closed > 0.95) {
    const tip = v.project(g.tip.u, t, g.tip.h);
    px(ctx, tip.x - width * 0.6, tip.y - width * 0.6, width * 1.2, width * 1.2, PAL.coverLiveRim);
  }
}

// ─────────────────────────────────────────────
// Chicken
// ─────────────────────────────────────────────

/**
 * The chicken's shadow: an ellipse under its feet, cast away from the light
 * and stretched as the hop lifts it — the one cue that tells a jump apart
 * from a slide.
 */
export function drawChickenShadow(
  ctx: CanvasRenderingContext2D,
  v: View,
  u: number,
  t: number,
  size: number,
  lift: number
) {
  const castFrom = v.shadowOf(u, t, size * 0.6 + lift);
  const c = v.project((u + castFrom.u) / 2, (t + castFrom.t) / 2);
  const s = v.scale(t);
  const spread = 1 + lift / (size * 1.2);
  const rx = size * 0.42 * s * spread + Math.abs(castFrom.u - u) * s * 0.35;
  const ry = size * 0.12 * s * spread;
  const alpha = 0.34 / spread;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.scale(1, ry / rx);
  ctx.translate(-c.x, -c.y);
  ctx.fillStyle = `rgba(8,12,20,${alpha * 0.6})`;
  ctx.beginPath();
  ctx.arc(c.x, c.y, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x, y + radius);
  ctx.closePath();
}

/**
 * Which renderer draws the player.
 *
 * `vector` is the default because it is simply the higher-quality of the two.
 * The image path loads `/chicken.modal.jpg`, whose transparency was flattened
 * into an opaque checkerboard when it was saved as JPEG; `spriteMask.ts` keys
 * that back out at load, but the bird is white against a white-and-grey
 * background and the recovered silhouette keeps a small ragged bite near the
 * left cheek. The vector rooster has real transparency, no artefacts, and stays
 * crisp at any device pixel ratio instead of being downscaled from 617px.
 *
 * Switch to `'image'` to go back to the photographic sprite — both paths size
 * from the same box, so nothing else changes.
 */
export const CHICKEN_RENDERER: 'vector' | 'image' = 'vector';

/** Where the image renderer sources the player. Keyed at load — see `spriteMask.ts`. */
export const CHICKEN_SPRITE_SRC = '/chicken.modal.jpg';

/**
 * Draws the chicken sprite centred on (cx, cy), scaled to `boxH` tall.
 *
 * The source is cropped to the silhouette before it gets here, so centring the
 * image *is* centring the bird. Width follows from the sprite's own aspect
 * ratio rather than the lane box, which is what keeps it from being stretched
 * as lane width and stage height change independently.
 */
export function drawChickenSprite(
  ctx: CanvasRenderingContext2D,
  sprite: KeyedSprite,
  cx: number,
  cy: number,
  boxH: number
) {
  const aspect = sprite.width / sprite.height;
  const drawH = boxH;
  const drawW = boxH * aspect;
  ctx.drawImage(sprite.canvas, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
}

/**
 * The rooster drawn as smooth vector shapes — no pixel grid, no image. Facing
 * right, the direction it crosses in. Centred on (cx, cy) in a box `boxH` tall
 * with its feet 0.45 of the box below the centre, the same anchor the pixel
 * versions used, so the hop, the shadow and the tap target all line up.
 *
 * The silhouette (tail, body, head) is drawn twice: once with a thick dark
 * stroke as the outline, then filled on top, so the joins between the shapes
 * vanish and only the outer edge keeps its line. Flat colours throughout.
 */
export function drawChickenSmooth(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  boxH: number,
  timeSeconds: number
) {
  const u = boxH;
  const bob = Math.sin(timeSeconds * 6) * u * 0.012;
  const y = cy + bob;
  const flap = Math.sin(timeSeconds * 9) * 0.12;
  const OUTLINE = '#2c3442';
  const WHITE = '#fbfbf7';
  const SHADE = '#e4e8ef';
  const RED = '#e2434b';
  const ORANGE = '#f2a52c';

  const ellipse = (x: number, yy: number, rx: number, ry: number, rot = 0) => {
    ctx.beginPath();
    ctx.ellipse(x, yy, rx, ry, rot, 0, Math.PI * 2);
  };
  const circle = (x: number, yy: number, r: number) => {
    ctx.beginPath();
    ctx.arc(x, yy, r, 0, Math.PI * 2);
  };

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // ── Legs and feet ──
  const footY = cy + u * 0.45;
  ctx.strokeStyle = ORANGE;
  ctx.lineWidth = Math.max(1.5, u * 0.045);
  for (const dx of [-0.07, 0.07]) {
    const lx = cx + dx * u;
    ctx.beginPath();
    ctx.moveTo(lx, y + u * 0.2);
    ctx.lineTo(lx, footY);
    ctx.moveTo(lx - u * 0.05, footY);
    ctx.lineTo(lx + u * 0.08, footY);
    ctx.stroke();
  }

  // ── Silhouette: outline pass, then fill pass ──
  const tail = () => ellipse(cx - u * 0.3, y - u * 0.1, u * 0.14, u * 0.2, -0.5);
  const body = () => ellipse(cx - u * 0.02, y + u * 0.02, u * 0.33, u * 0.25);
  const head = () => circle(cx + u * 0.2, y - u * 0.24, u * 0.16);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(2, u * 0.05);
  for (const shape of [tail, body, head]) {
    shape();
    ctx.stroke();
  }
  ctx.fillStyle = WHITE;
  for (const shape of [tail, body, head]) {
    shape();
    ctx.fill();
  }

  // Belly shade, low on the body — a second flat colour, not a gradient.
  ellipse(cx - u * 0.02, y + u * 0.13, u * 0.24, u * 0.1);
  ctx.fillStyle = SHADE;
  ctx.fill();

  // ── Wing, with a little flap ──
  ellipse(cx - u * 0.06, y + u * 0.02, u * 0.17, u * 0.11, -0.25 + flap);
  ctx.fillStyle = SHADE;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(1, u * 0.025);
  ctx.stroke();

  // ── Comb and wattle ──
  ctx.fillStyle = RED;
  for (const [dx, dy, r] of [[0.12, -0.39, 0.055], [0.2, -0.43, 0.065], [0.28, -0.38, 0.05]] as const) {
    circle(cx + dx * u, y + dy * u, r * u);
    ctx.fill();
  }
  ellipse(cx + u * 0.32, y - u * 0.13, u * 0.04, u * 0.06);
  ctx.fill();

  // ── Beak ──
  ctx.beginPath();
  ctx.moveTo(cx + u * 0.33, y - u * 0.28);
  ctx.lineTo(cx + u * 0.47, y - u * 0.22);
  ctx.lineTo(cx + u * 0.33, y - u * 0.17);
  ctx.closePath();
  ctx.fillStyle = ORANGE;
  ctx.fill();

  // ── Eye with a highlight ──
  circle(cx + u * 0.24, y - u * 0.27, u * 0.035);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  circle(cx + u * 0.25, y - u * 0.28, u * 0.012);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.restore();
}

/**
 * The rooster, facing right — the direction it crosses in.
 *
 * Drawn from the pixel matrices in `pixel.ts` rather than from paths. The board
 * resolves its world into a buffer a quarter of the stage's size, and the bird
 * is the smallest thing on it that has to stay readable: as layered curves,
 * gradients and round-capped strokes it came back through that downscale as a
 * white blob with no beak and no comb. A matrix places every feature at a size
 * that survives, because the size *is* what was authored.
 *
 * `cy` is the centre of the collision box, as before — the sprite is blitted
 * from its feet, so the conversion happens here and callers are unchanged.
 */
export function drawChicken(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  boxH: number,
  timeSeconds: number
) {
  // Two-frame cycle. The old bob eased continuously about the feet; a pixel
  // bird steps between frames instead, which also keeps the sprite on whole
  // rows — an eased translate puts it back on fractional ones and the outline
  // shimmers as it moves.
  const frame = chickenFrame(timeSeconds);
  const footY = cy + boxH * 0.5;
  drawSprite(ctx, frame, cx, footY, boxH);
}
