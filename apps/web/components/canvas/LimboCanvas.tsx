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
  GOLD,
  NEG,
  POS,
  TABLES,
  alpha,
  neu,
  neuInset,
  roundRectPath,
  shade,
} from './three';

const THEME = TABLES.limbo;

export interface LimboRound {
  id: string;
  achievedMultiplier: number;
  win: boolean;
}

export interface LimboCanvasProps {
  target: number;
  round: LimboRound | null;
  onRollComplete?: () => void;
  height?: number;
  className?: string;
}

const ROLLOUT_MS = 850;

export function LimboCanvas({
  target,
  round,
  onRollComplete,
  height = 260,
  className,
}: LimboCanvasProps) {
  const reducedMotion = usePrefersReducedMotion();

  const runRef = useRef<{ id: string; startedAt: number; done: boolean } | null>(null);
  const onCompleteRef = useRef(onRollComplete);
  onCompleteRef.current = onRollComplete;

  useEffect(() => {
    if (!round) {
      runRef.current = null;
      return;
    }
    if (runRef.current?.id === round.id) return;
    runRef.current = { id: round.id, startedAt: performance.now(), done: false };
  }, [round]);

  const draw = useMemo(
    () =>
      ({ ctx, width, height: h }: CanvasFrame) => {
        ctx.fillStyle = THEME.surface;
        ctx.fillRect(0, 0, width, h);

        const achieved = round?.achievedMultiplier ?? 1;
        const run = runRef.current;

        let value = 1;
        if (run) {
          const t = reducedMotion ? 1 : Math.min(1, (performance.now() - run.startedAt) / ROLLOUT_MS);
          const eased = 1 - Math.pow(1 - t, 3);
          value = Math.exp(Math.log(Math.max(achieved, 1.0001)) * eased);
          if (t >= 1 && !run.done) {
            run.done = true;
            onCompleteRef.current?.();
          }
        }

        const settled = run?.done === true;
        const win = settled ? round?.win === true : null;
        const tint = win === null ? BOARD.text : win ? POS : NEG;

        const readoutY = h * 0.4;
        const size = Math.min(72, width * 0.17);
        const plateW = Math.min(width - 32, size * 5.2);
        const plateH = size * (settled ? 2 : 1.5);
        const plateTop = readoutY - size * 0.75;
        neu(ctx, () => {
          ctx.fillStyle = THEME.surface;
          ctx.fill(roundRectPath(width / 2 - plateW / 2, plateTop, plateW, plateH, 18));
        }, 1.2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = tint;
        ctx.font = `700 ${size}px ${FONT.num}`;
        ctx.fillText(`${formatMultiplier(value)}x`, width / 2, readoutY);

        if (settled) {
          ctx.fillStyle = win ? POS : NEG;
          ctx.font = `800 13px ${FONT.body}`;
          ctx.fillText(win ? 'TARGET CLEARED' : 'BELOW TARGET', width / 2, readoutY + size * 0.72);
        }

        const pad = Math.min(width * 0.1, 52);
        const left = pad;
        const span = width - pad * 2;
        const barY = h * 0.78;
        const barH = 12;
        const logTarget = Math.log(Math.max(target, 1.0001));
        const progress = Math.min(1.12, Math.log(Math.max(value, 1)) / logTarget);

        const bar = roundRectPath(left, barY, span, barH, barH / 2);
        neuInset(ctx, bar, shade(THEME.surface, -0.18), 0.5);

        if (progress > 0) {
          ctx.save();
          ctx.clip(bar);
          ctx.fillStyle = win === false ? NEG : win === true ? POS : THEME.hue;
          ctx.fillRect(left, barY, span * Math.min(1, progress), barH);
          ctx.restore();
        }

        const targetX = left + span;
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(Math.round(targetX) + 0.5, barY - 7);
        ctx.lineTo(Math.round(targetX) + 0.5, barY + barH + 7);
        ctx.stroke();

        ctx.font = `600 11px ${FONT.num}`;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillStyle = BOARD.dim;
        ctx.fillText('1.00x', left, barY + barH + 10);
        ctx.textAlign = 'right';
        ctx.fillStyle = alpha(GOLD, 0.9);
        ctx.fillText(`${formatMultiplier(target)}x`, targetX, barY + barH + 10);

      },
    [target, round, reducedMotion]
  );

  const canvasRef = useCanvasRenderer(draw);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: 'block', width: '100%', height }}
      role="img"
      aria-label={
        round
          ? `Limbo. Rolled ${formatMultiplier(round.achievedMultiplier)}x against a target of ${formatMultiplier(target)}x`
          : `Limbo. Target ${formatMultiplier(target)}x`
      }
    />
  );
}

function formatMultiplier(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toFixed(2);
}

export default LimboCanvas;
