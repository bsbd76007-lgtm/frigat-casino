'use client';

import { useEffect, useMemo, useRef } from 'react';

import {
  ROULETTE_WHEEL_ORDER,
  pocketColor,
  type RoulettePocketColor,
} from '@frigat/shared/constants';

import {
  useCanvasRenderer,
  usePrefersReducedMotion,
  type CanvasFrame,
} from '@/lib/useCanvasRenderer';

import {
  BOARD,
  FONT,
  GOLD,
  GOLD_SOFT,
  NEG,
  POS,
  alpha,
} from './three';

export const WHEEL_ORDER = ROULETTE_WHEEL_ORDER;
export { pocketColor };
export type { RoulettePocketColor };

export type RoulettePhase = 'IDLE' | 'SPINNING' | 'RESULT';

export interface RouletteCanvasProps {
  phase: RoulettePhase;
  pocket: number | null;
  spinDurationMs?: number;
  onSpinComplete?: (pocket: number) => void;
  size?: number;
  className?: string;
}

const WHEEL = {
  red: '#c8384a',
  black: '#1c1f26',
  green: POS,
  frame: '#3a2a20',
  frameLit: '#5a4232',
  track: '#2b3a34',
  cone: '#24302b',
  coneLit: '#30403a',
  gold: '#c9a24a',
  number: '#f4f4f7',
  ball: '#f4f4f7',
  separator: '#c9a24a',
} as const;

export const SEGMENT = (Math.PI * 2) / WHEEL_ORDER.length;
export const MARKER_ANGLE = -Math.PI / 2;
const IDLE_RATE = 0.00022;
const BALL_ORBITS = 6;
const WHEEL_SPINS = 4;

export function wheelAngleForPocket(
  pocket: number,
  fromAngle = 0,
  extraSpins = WHEEL_SPINS
): number {
  const seat = WHEEL_ORDER.indexOf(pocket);
  if (seat < 0) throw new Error(`roulette: pocket ${pocket} is not on the wheel`);

  let target = MARKER_ANGLE - (seat * SEGMENT + SEGMENT / 2);
  while (target < fromAngle) target += Math.PI * 2;
  return target + Math.PI * 2 * extraSpins;
}

const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;
const smoothstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

interface Landing {
  pocket: number;
  startedAt: number;
  wheelFrom: number;
  wheelTo: number;
  ballFrom: number;
  ballTo: number;
  notified: boolean;
}

export function RouletteCanvas({
  phase,
  pocket,
  spinDurationMs = 4200,
  onSpinComplete,
  size = 340,
  className,
}: RouletteCanvasProps) {
  const reducedMotion = usePrefersReducedMotion();

  const idleAngleRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);
  const landingRef = useRef<Landing | null>(null);
  const onCompleteRef = useRef(onSpinComplete);
  onCompleteRef.current = onSpinComplete;

  const duration = reducedMotion ? 1 : Math.max(1, spinDurationMs);

  useEffect(() => {
    if (pocket === null || phase === 'IDLE') {
      landingRef.current = null;
      return;
    }
    if (landingRef.current?.pocket === pocket) return;

    if (!WHEEL_ORDER.includes(pocket)) return;

    const wheelFrom = idleAngleRef.current;
    const wheelTo = wheelAngleForPocket(pocket, wheelFrom);

    const ballFrom = MARKER_ANGLE + Math.PI;
    const ballTo = MARKER_ANGLE - Math.PI * 2 * BALL_ORBITS;

    landingRef.current = {
      pocket,
      startedAt: performance.now(),
      wheelFrom,
      wheelTo,
      ballFrom,
      ballTo,
      notified: false,
    };
  }, [pocket, phase]);

  const draw = useMemo(
    () =>
      ({ ctx, width, height, time }: CanvasFrame) => {
        const outer = Math.min(width, height) * 0.42;
        if (outer <= 12) return;

        const cx = width / 2;
        const cy = height * 0.55;

        const rimInner = outer * 0.9;
        const trackRadius = outer * 0.84;
        const pocketOuter = outer * 0.76;
        const pocketInner = outer * 0.5;
        const hub = outer * 0.34;
        const restRadius = (pocketOuter + pocketInner) / 2;

        const now = performance.now();
        const delta = lastTimeRef.current === null ? 0 : now - lastTimeRef.current;
        lastTimeRef.current = now;

        const landing = landingRef.current;
        let wheelAngle: number;
        let progress = 1;

        if (landing) {
          progress = Math.min(1, (now - landing.startedAt) / duration);
          const eased = easeOutQuart(progress);
          wheelAngle = landing.wheelFrom + (landing.wheelTo - landing.wheelFrom) * eased;
          idleAngleRef.current = wheelAngle;

          if (progress >= 1 && !landing.notified) {
            landing.notified = true;
            onCompleteRef.current?.(landing.pocket);
          }
        } else {
          const spinning = phase === 'SPINNING' && !reducedMotion;
          idleAngleRef.current += delta * (spinning ? IDLE_RATE * 8 : IDLE_RATE);
          wheelAngle = idleAngleRef.current;
        }

        const winning = landing && progress >= 1 ? landing.pocket : null;

        ctx.clearRect(0, 0, width, height);

        disc(ctx, cx, cy, outer, WHEEL.frame);
        disc(ctx, cx, cy, rimInner, WHEEL.track);
        ring(ctx, cx, cy, rimInner, WHEEL.frameLit, Math.max(1, outer * 0.012));

        const numberSize = Math.max(8, outer * 0.075);
        WHEEL_ORDER.forEach((value, index) => {
          const start = wheelAngle + index * SEGMENT;
          const colour = pocketColor(value);
          const fill =
            colour === 'GREEN' ? WHEEL.green : colour === 'RED' ? WHEEL.red : WHEEL.black;
          wedge(ctx, cx, cy, pocketInner, pocketOuter, start, SEGMENT, fill);
          if (winning === value) {
            const pulse = reducedMotion ? 0.7 : 0.55 + Math.sin(time / 160) * 0.35;
            wedge(ctx, cx, cy, pocketInner, pocketOuter, start, SEGMENT, alpha(GOLD, 0.45 * pulse));
            ctx.strokeStyle = GOLD;
            ctx.lineWidth = 2.5;
            ctx.stroke();
          }
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(start + SEGMENT / 2 + Math.PI / 2);
          ctx.fillStyle = winning === value ? '#2a1a03' : WHEEL.number;
          ctx.font = `800 ${numberSize}px ${FONT.num}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(value), 0, -(pocketOuter - numberSize * 0.95));
          ctx.restore();
        });

        ctx.strokeStyle = WHEEL.separator;
        ctx.lineWidth = Math.max(1, outer * 0.008);
        for (let index = 0; index < WHEEL_ORDER.length; index += 1) {
          const a = wheelAngle + index * SEGMENT;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * pocketInner, cy + Math.sin(a) * pocketInner);
          ctx.lineTo(cx + Math.cos(a) * pocketOuter, cy + Math.sin(a) * pocketOuter);
          ctx.stroke();
        }
        ring(ctx, cx, cy, pocketOuter, WHEEL.gold, Math.max(1.5, outer * 0.014));
        ring(ctx, cx, cy, pocketInner, WHEEL.gold, Math.max(1.5, outer * 0.014));

        disc(ctx, cx, cy, pocketInner - outer * 0.01, WHEEL.cone);
        disc(ctx, cx, cy, hub, WHEEL.coneLit);
        ctx.strokeStyle = WHEEL.gold;
        ctx.lineWidth = Math.max(2, outer * 0.03);
        ctx.lineCap = 'round';
        for (let k = 0; k < 4; k += 1) {
          const a = wheelAngle + (k * Math.PI) / 2;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * hub * 0.25, cy + Math.sin(a) * hub * 0.25);
          ctx.lineTo(cx + Math.cos(a) * hub * 0.9, cy + Math.sin(a) * hub * 0.9);
          ctx.stroke();
        }
        disc(ctx, cx, cy, hub * 0.24, WHEEL.gold);

        if (landing) {
          const eased = easeOutQuart(progress);
          const ballAngle = landing.ballFrom + (landing.ballTo - landing.ballFrom) * eased;
          const fall = smoothstep((progress - 0.45) / 0.55);
          const bounce =
            progress > 0.45 && progress < 0.98 && !reducedMotion
              ? Math.abs(Math.sin(progress * 26)) * (1 - fall) * outer * 0.03
              : 0;
          const radius = trackRadius + (restRadius - trackRadius) * fall + bounce;
          const rr = Math.max(3, outer * 0.04);
          const bx = cx + Math.cos(ballAngle) * radius;
          const by = cy + Math.sin(ballAngle) * radius;
          disc(ctx, bx + rr * 0.25, by + rr * 0.3, rr, 'rgba(0,0,0,.35)');
          disc(ctx, bx, by, rr, WHEEL.ball);
        }

        ctx.beginPath();
        ctx.moveTo(cx - outer * 0.05, cy - outer - outer * 0.07);
        ctx.lineTo(cx + outer * 0.05, cy - outer - outer * 0.07);
        ctx.lineTo(cx, cy - outer + outer * 0.04);
        ctx.closePath();
        ctx.fillStyle = GOLD;
        ctx.fill();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const readoutY = Math.max(14, (cy - outer - outer * 0.07) / 2);
        if (winning !== null) {
          const colour = pocketColor(winning);
          const text = `${winning} ${colour}`;
          ctx.font = `800 ${Math.max(11, Math.min(16, outer * 0.1))}px ${FONT.num}`;
          const pill = ctx.measureText(text).width + 22;
          const pillH = Math.max(20, Math.min(outer * 0.13, height * 0.075));
          roundedPill(ctx, width / 2 - pill / 2, readoutY - pillH / 2, pill, pillH, alpha(GOLD, 0.16));
          ctx.strokeStyle = alpha(GOLD, 0.5);
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle =
            colour === 'GREEN' ? WHEEL.green : colour === 'RED' ? NEG : GOLD_SOFT;
          ctx.fillText(text, width / 2, readoutY + 0.5);
        } else {
          ctx.fillStyle = BOARD.muted;
          ctx.font = `700 ${Math.max(10, Math.min(13, outer * 0.07))}px ${FONT.body}`;
          ctx.fillText(phase === 'SPINNING' ? 'SPINNING' : 'PLACE BETS', width / 2, readoutY);
        }

      },
    [phase, duration, reducedMotion]
  );

  const canvasRef = useCanvasRenderer(draw);

  const label =
    phase === 'RESULT' && pocket !== null
      ? `Roulette result: ${pocket} ${pocketColor(pocket).toLowerCase()}`
      : phase === 'SPINNING'
        ? 'Roulette wheel spinning'
        : 'European roulette wheel, awaiting bets';

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        display: 'block',
        width: '100%',
        maxWidth: size * 1.2,
        aspectRatio: '1 / 1',
        margin: '0 auto',
      }}
      role="img"
      aria-label={label}
    />
  );
}

function roundedPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string
): void {
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function ring(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  stroke: string,
  lineWidth: number
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function wedge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  inner: number,
  outer: number,
  from: number,
  sweep: number,
  fill: string
): void {
  ctx.beginPath();
  ctx.arc(x, y, outer, from, from + sweep);
  ctx.arc(x, y, inner, from + sweep, from, true);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

export default RouletteCanvas;
