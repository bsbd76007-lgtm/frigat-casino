'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  CrashCanvas,
  elapsedSecondsFor,
  multiplierAtSeconds,
  type CrashPhase,
} from '@/components/canvas/CrashCanvas';
import { BetControls } from '@/components/games/BetControls';
import { GameShell } from '@/components/games/GameShell';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useGameRound } from '@/hooks/useGameRound';

const AFTER_FLIGHT_MAX_SECONDS = 6;

export default function CrashPage() {
  const { socket, balance, send, crashRounds } = useGameSocket();
  const { t } = useLanguage();


  const [amount, setAmount] = useState('1.00');
  const [phase, setPhase] = useState<CrashPhase>('IDLE');
  const [multiplier, setMultiplier] = useState(1);
  const [crashPoint, setCrashPoint] = useState<number | null>(null);
  const [cashedOutAt, setCashedOutAt] = useState<number | null>(null);
  const [hasBet, setHasBet] = useState(false);
  const [afterFlight, setAfterFlight] = useState<{ from: number; to: number } | null>(null);

  const { busy, begin, settle, bet } = useGameRound('CRASH', {
    on: {
      CRASH_ROUND_START: () => {
        setPhase('RUNNING');
        setMultiplier(1);
        setCrashPoint(null);
        setCashedOutAt(null);
        setAfterFlight(null);
        settle();
      },
      CRASH_TICK: (data) => {
        if (typeof data.multiplier === 'number') setMultiplier(data.multiplier);
      },
      CRASH_ROUND_END: (data) => {
        setHasBet(false);
        settle();

        if (data.cashedOut) {
          setPhase('CASHED_OUT');
          if (typeof data.multiplier === 'number') {
            setCashedOutAt(data.multiplier);
            setMultiplier(data.multiplier);
            if (typeof data.crashPoint === 'number') {
              setCrashPoint(data.crashPoint);
              if (data.crashPoint > data.multiplier) {
                setAfterFlight({ from: data.multiplier, to: data.crashPoint });
              }
            }
          }
          return;
        }

        setPhase('CRASHED');
        if (typeof data.crashPoint === 'number') {
          setCrashPoint(data.crashPoint);
          setMultiplier(data.crashPoint);
        }
      },
      BET_ACCEPTED: (data) => {
        setHasBet(true);
        settle();
        if (typeof data.amount === 'string') setAmount(data.amount);
      },
      RESUME_NONE: () => {
      },
    },
    onResult: ({ win, raw }) => {
      if (win && typeof raw.multiplier === 'number') {
        setCashedOutAt(raw.multiplier);
      }
    },
  });

  useEffect(() => {
    if (!afterFlight || phase !== 'CASHED_OUT') return;
    const t0 = elapsedSecondsFor(afterFlight.from);
    const t1 = elapsedSecondsFor(afterFlight.to);
    const durationMs = Math.min(t1 - t0, AFTER_FLIGHT_MAX_SECONDS) * 1000;
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const k = durationMs <= 0 ? 1 : Math.min(1, (now - started) / durationMs);
      if (k >= 1) {
        setMultiplier(afterFlight.to);
        setPhase('CRASHED');
        setAfterFlight(null);
        return;
      }
      setMultiplier(multiplierAtSeconds(t0 + (t1 - t0) * k));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [afterFlight, phase]);

  useEffect(() => {
    if (!socket.isOpen) return;
    send('RESUME', 'CRASH');
  }, [socket.isOpen, send]);

  const history = useMemo(
    () =>
      crashRounds.map((round) => ({
        id: round.id,
        multiplier: round.crashPoint,
        gameType: 'CRASH' as const,
      })),
    [crashRounds]
  );

  const hasCashedOut = cashedOutAt !== null;
  const roundOver = phase === 'CRASHED' || phase === 'CASHED_OUT';
  const canBet = !hasBet && (phase === 'IDLE' || roundOver);
  const canCashout = phase === 'RUNNING' && hasBet && !hasCashedOut;

  return (
    <GameShell
      gameType="CRASH"
      title={t('games.crash.name')}
      subtitle={t('games.crash.subtitle')}
      history={history}
      stage={
        <CrashCanvas
          phase={phase}
          multiplier={multiplier}
          crashPoint={crashPoint}
          cashedOutAt={cashedOutAt}
          height={360}
        />
      }
      panel={
        <>
          <div className="opt">
            <span className="opt__label">{t('game.round')}</span>
            <div className="opt__stat">
              <span>{t('game.phase')}</span>
              <b>{phase}</b>
            </div>
            <div className="opt__stat">
              <span>{t('game.yourBet')}</span>
              <b>{hasBet ? `${amount} in play` : '—'}</b>
            </div>
            {cashedOutAt !== null && (
              <div className="opt__stat">
                <span>{t('game.cashedOut')}</span>
                <b style={{ color: 'var(--fg-gold)' }}>{cashedOutAt.toFixed(2)}×</b>
              </div>
            )}
            {cashedOutAt !== null && crashPoint !== null && (
              <div className="opt__stat">
                <span>{t('game.rocketFlewTo')}</span>
                <b style={{ color: phase === 'CRASHED' ? 'var(--fg-red)' : 'var(--fg-text)' }}>
                  {(phase === 'CRASHED' ? crashPoint : multiplier).toFixed(2)}×
                </b>
              </div>
            )}
          </div>

          <BetControls
            amount={amount}
            onAmountChange={setAmount}
            balance={balance.balance}
            currency={balance.currency}
            canCashout={canCashout}
            cashoutTone="accent"
            cashoutMultiplier={canCashout ? multiplier : null}
            cashoutAmount={
              canCashout ? (Number(amount) * multiplier).toFixed(2) : null
            }
            onBet={() => bet('BET', { amount, currency: balance.currency })}
            onCashout={() => {
              begin();
              send('CASHOUT', 'CRASH');
            }}
            disabled={!canBet && !canCashout}
            busy={busy}
            betLabel={canBet ? t('game.placeBet') : t('game.roundInProgress')}
          />
        </>
      }
    />
  );
}
