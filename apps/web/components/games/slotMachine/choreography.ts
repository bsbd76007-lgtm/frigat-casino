'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { SlotSymbol } from '@frigat/shared';

export const TIMING = {
  accelerateMs: 380,
  minSpinMs: 950,
  stagger: 200,
  settleMs: 520,
  topSpeed: 26,
} as const;

export const SETTLE_TRAVEL = 7;

export const STRIP_LENGTH = 64;

export type ReelPhase = 'idle' | 'accelerating' | 'spinning' | 'settling' | 'stopped';

export interface Reel {
  strip: SlotSymbol[];
  offset: number;
  velocity: number;
  phase: ReelPhase;
  settleAt: number | null;
  settleFrom: number;
  settleTo: number;
  settleStartedAt: number;
}

export interface SlotSpinResponse {
  sessionId: string;
  reelMatrix: SlotSymbol[][];
  winningLines: Array<{
    lineIndex: number;
    symbol: SlotSymbol;
    count: number;
    cells: Array<[number, number]>;
    payout: string;
  }>;
  totalWin: string;
  newBalance: string;
  betAmount: string;
  multiplier: number;
  hashedServerSeed: string;
  clientSeed: string;
  nonce: number;
}

export interface SlotSounds {
  onSpinStart: () => void;
  onReelStop: (reelIndex: number) => void;
  onWin: (totalWin: string) => void;
  onLose: () => void;
}

export const SILENT: SlotSounds = {
  onSpinStart: () => {},
  onReelStop: () => {},
  onWin: () => {},
  onLose: () => {},
};

export function useDefaultSounds(enabled: boolean): SlotSounds {
  const ctxRef = useRef<AudioContext | null>(null);

  const tone = useCallback(
    (frequency: number, durationMs: number, type: OscillatorType = 'triangle', gain = 0.05) => {
      if (!enabled || typeof window === 'undefined') return;
      const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctor) return;
      const audio: AudioContext = ctxRef.current ?? (ctxRef.current = new Ctor());
      if (audio.state === 'suspended') void audio.resume();

      const osc = audio.createOscillator();
      const amp = audio.createGain();
      osc.type = type;
      osc.frequency.value = frequency;
      amp.gain.setValueAtTime(gain, audio.currentTime);
      amp.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + durationMs / 1000);
      osc.connect(amp).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + durationMs / 1000);
    },
    [enabled]
  );

  useEffect(
    () => () => {
      void ctxRef.current?.close();
      ctxRef.current = null;
    },
    []
  );

  return useMemo<SlotSounds>(
    () => ({
      onSpinStart: () => tone(180, 140, 'sawtooth', 0.035),
      onReelStop: (reel) => tone(300 + reel * 45, 90, 'square', 0.03),
      onWin: () => {
        tone(660, 140);
        window.setTimeout(() => tone(880, 180), 120);
        window.setTimeout(() => tone(1180, 260), 260);
      },
      onLose: () => tone(140, 180, 'sine', 0.02),
    }),
    [tone]
  );
}

