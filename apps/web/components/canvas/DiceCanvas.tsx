'use client';

import { useEffect, useMemo, useRef } from 'react';

import {
  useCanvasRenderer,
  usePrefersReducedMotion,
  type CanvasFrame,
} from '@/lib/useCanvasRenderer';

import {
  BOARD,
  FONT,
  NEG,
  POS,
  TABLES,
  alpha,
  neu,
  neuInset,
  roundRectPath,
  shade,
} from './three';

const THEME = TABLES.dice;

export type DiceDirection = 'OVER' | 'UNDER';

export interface DiceCanvasProps {
  target: number;
  direction: DiceDirection;
  roll: number | null;
  rollId: string | null;
  won: boolean | null;
  onRollComplete?: () => void;
  height?: number;
  className?: string;
}

const SLIDE_MS = 520;
const TRACK_H = 16;
const TICKS = [0, 25, 50, 75, 100];

export function DiceCanvas({
  target,
  direction,
  roll,
  rollId,
  won,
  onRollComplete,
  height = 210,
  className,
}: DiceCanvasProps) {
  const reducedMotion = usePrefersReducedMotion();

  const markerRef = useRef(50);
  const slideRef = useRef<{ from: number; to: number; startedAt: number; done: boolean } | null>(
    null
  );
  const onCompleteRef = useRef(onRollComplete);
  onCompleteRef.current = onRollComplete;

  useEffect(() => {
    if (rollId === null || roll === null) {
      slideRef.current = null;
      return;
    }
    slideRef.current = { from: markerRef.current, to: roll, startedAt: performance.now(), done: false };
  }, [rollId, roll]);

  const draw = useMemo(
    () =>
      ({ ctx, width, height: h }: CanvasFrame) => {
        ctx.fillStyle = THEME.surface;
        ctx.fillRect(0, 0, width, h);

        const pad = Math.min(width * 0.08, 44);
        const left = pad;
        const right = width - pad;
        const span = right - left;
        const at = (value: number) => left + (span * Math.min(100, Math.max(0, value))) / 100;

        const slide = slideRef.current;
        let marker = markerRef.current;
        if (slide) {
          const t = reducedMotion ? 1 : Math.min(1, (performance.now() - slide.startedAt) / SLIDE_MS);
          const eased = 1 - Math.pow(1 - t, 4);
          marker = slide.from + (slide.to - slide.from) * eased;
          if (t >= 1 && !slide.done) {
            slide.done = true;
            marker = slide.to;
            onCompleteRef.current?.();
          }
        }
        markerRef.current = marker;

        const settled = slide?.done === true;
        const outcome = settled && won !== null ? (won ? POS : NEG) : null;
        const trackY = h * 0.52;

        const rail = roundRectPath(left, trackY - TRACK_H / 2, span, TRACK_H, TRACK_H / 2);
        neuInset(ctx, rail, shade(THEME.surface, -0.18), 0.6);

        const zoneFrom = direction === 'UNDER' ? left : at(target);
        const zoneTo = direction === 'UNDER' ? at(target) : right;
        if (zoneTo - zoneFrom > 1) {
          ctx.save();
          ctx.clip(rail);
          ctx.fillStyle = THEME.hue;
          ctx.fillRect(zoneFrom, trackY - TRACK_H / 2, zoneTo - zoneFrom, TRACK_H);
          ctx.restore();
        }

        ctx.font = `600 11px ${FONT.num}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (const tick of TICKS) {
          const x = at(tick);
          ctx.strokeStyle = THEME.line;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(Math.round(x) + 0.5, trackY + TRACK_H / 2 + 4);
          ctx.lineTo(Math.round(x) + 0.5, trackY + TRACK_H / 2 + 9);
          ctx.stroke();
          ctx.fillStyle = BOARD.dim;
          ctx.fillText(String(tick), x, trackY + TRACK_H / 2 + 13);
        }

        const lineX = Math.round(at(target)) + 0.5;
        ctx.strokeStyle = BOARD.text;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(lineX, trackY - TRACK_H / 2 - 7);
        ctx.lineTo(lineX, trackY + TRACK_H / 2 + 7);
        ctx.stroke();
        ctx.fillStyle = BOARD.muted;
        ctx.font = `700 10px ${FONT.body}`;
        ctx.textBaseline = 'bottom';
        ctx.fillText(
          `${direction} ${target}`,
          Math.min(right - 28, Math.max(left + 28, lineX)),
          trackY - TRACK_H / 2 - 11
        );

        const markerX = at(marker);
        const tint = outcome ?? BOARD.text;

        const bubbleW = 86;
        const bubbleH = 38;
        const bubbleX = Math.min(right - bubbleW / 2, Math.max(left + bubbleW / 2, markerX));
        const bubbleY = trackY - TRACK_H / 2 - 62;

        const plate = roundRectPath(bubbleX - bubbleW / 2, bubbleY, bubbleW, bubbleH, 10);
        neu(ctx, () => {
          ctx.fillStyle = THEME.surface;
          ctx.fill(plate);
        }, 0.9);
        if (outcome) {
          ctx.strokeStyle = alpha(outcome, 0.6);
          ctx.lineWidth = 1.5;
          ctx.stroke(plate);
        }

        ctx.fillStyle = tint;
        ctx.font = `700 26px ${FONT.num}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((settled && roll !== null ? roll : marker).toFixed(2), bubbleX, bubbleY + bubbleH / 2);

        ctx.strokeStyle = alpha(tint, 0.45);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(bubbleX, bubbleY + bubbleH + 2);
        ctx.lineTo(markerX, trackY - TRACK_H / 2 - 6);
        ctx.stroke();

        roundedRect(ctx, markerX - 2, trackY - TRACK_H / 2 - 6, 4, TRACK_H + 12, 2);
        ctx.fillStyle = tint;
        ctx.fill();

      },
    [target, direction, roll, won, reducedMotion]
  );

  const canvasRef = useCanvasRenderer(draw);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: 'block', width: '100%', height }}
      role="img"
      aria-label={
        roll !== null
          ? `Dice rail. Rolled ${roll.toFixed(2)}, ${direction.toLowerCase()} ${target}`
          : `Dice rail. Win zone is ${direction.toLowerCase()} ${target}`
      }
    />
  );
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export default DiceCanvas;
