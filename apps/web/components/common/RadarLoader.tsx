'use client';

import { useCallback, useMemo, useRef } from 'react';

import { useCanvasRenderer, type CanvasFrame } from '@/lib/useCanvasRenderer';

export interface RadarLoaderProps {
  size?: number;
  speed?: number;
  label?: string;
}

interface Contact {
  angle: number;
  radius: number;
  size: number;
}

const ACCENT = '59, 124, 255';

export function RadarLoader({ size = 96, speed = 0.55, label }: RadarLoaderProps) {
  const beamRef = useRef(0);

  const contacts = useMemo<Contact[]>(
    () =>
      Array.from({ length: 5 }, () => ({
        angle: Math.random() * Math.PI * 2,
        radius: 0.32 + Math.random() * 0.5,
        size: 1.6 + Math.random() * 1.8,
      })),
    []
  );

  const draw = useCallback(
    ({ ctx, width, height, delta }: CanvasFrame) => {
      const reduced =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const cx = width / 2;
      const cy = height / 2;
      const r = Math.min(width, height) / 2 - 2;

      if (!reduced) beamRef.current += (delta / 1000) * speed * Math.PI * 2;
      const beam = beamRef.current;

      ctx.clearRect(0, 0, width, height);

      ctx.fillStyle = `rgba(${ACCENT}, .05)`;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(${ACCENT}, .22)`;
      ctx.lineWidth = 1;
      for (const ring of [0.34, 0.67, 1]) {
        ctx.beginPath();
        ctx.arc(cx, cy, r * ring, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy + r);
      ctx.stroke();

      const TRAIL = Math.PI * 0.75;
      ctx.fillStyle = `rgba(${ACCENT}, .14)`;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, beam - TRAIL, beam);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = `rgba(${ACCENT}, .9)`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(beam) * r, cy + Math.sin(beam) * r);
      ctx.stroke();

      for (const contact of contacts) {
        let since = (beam - contact.angle) % (Math.PI * 2);
        if (since < 0) since += Math.PI * 2;
        const glow = reduced ? 0.5 : Math.max(0, 1 - since / (Math.PI * 1.1));
        if (glow <= 0.02) continue;
        const x = cx + Math.cos(contact.angle) * r * contact.radius;
        const y = cy + Math.sin(contact.angle) * r * contact.radius;
        ctx.fillStyle = `rgba(${ACCENT}, ${0.85 * glow})`;
        ctx.beginPath();
        ctx.arc(x, y, contact.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${ACCENT}, ${0.16 * glow})`;
        ctx.beginPath();
        ctx.arc(x, y, contact.size * 3.4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = `rgba(${ACCENT}, .95)`;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    },
    [contacts, speed]
  );

  const canvasRef = useCanvasRenderer(draw, { maxPixelRatio: 3 });

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, display: 'block' }}
      role="progressbar"
      aria-busy="true"
      aria-label={label ?? 'Loading'}
    />
  );
}

export default RadarLoader;
