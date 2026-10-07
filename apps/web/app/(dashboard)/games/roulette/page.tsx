'use client';

import { useRef, useState } from 'react';

import {
  RouletteCanvas,
  pocketColor,
  type RoulettePhase,
} from '@/components/canvas/RouletteCanvas';
import { BetControls } from '@/components/games/BetControls';
import { GameShell } from '@/components/games/GameShell';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useGameRound } from '@/hooks/useGameRound';

const POSITIONS: Array<{ id: string; label: string; pays: string }> = [
  { id: 'red', label: 'Red', pays: '2×' },
  { id: 'black', label: 'Black', pays: '2×' },
  { id: 'odd', label: 'Odd', pays: '2×' },
  { id: 'even', label: 'Even', pays: '2×' },
  { id: 'low', label: '1–18', pays: '2×' },
  { id: 'high', label: '19–36', pays: '2×' },
  { id: 'dozen:1', label: '1st 12', pays: '3×' },
  { id: 'dozen:2', label: '2nd 12', pays: '3×' },
  { id: 'dozen:3', label: '3rd 12', pays: '3×' },
  { id: 'column:1', label: 'Col 1', pays: '3×' },
  { id: 'column:2', label: 'Col 2', pays: '3×' },
  { id: 'column:3', label: 'Col 3', pays: '3×' },
];

export default function RoulettePage() {
  const { balance } = useGameSocket();
  const { t } = useLanguage();

  const [amount, setAmount] = useState('1.00');
  const [position, setPosition] = useState('red');
  const [straight, setStraight] = useState('');
  const [phase, setPhase] = useState<RoulettePhase>('IDLE');
  const [pocket, setPocket] = useState<number | null>(null);
  const [lastWin, setLastWin] = useState<boolean | null>(null);
  const pendingRef = useRef<{ pocket: number; win: boolean } | null>(null);
  const [heldBalance, setHeldBalance] = useState<string | null>(null);

  const { busy, bet, settle } = useGameRound<{ pocket?: number }>('ROULETTE', {
    autoSettle: false,
    onResult: ({ result, win }) => {
      if (typeof result?.pocket !== 'number') return;

      pendingRef.current = { pocket: result.pocket, win };
      setPocket(result.pocket);
    },
    onError: () => {
      pendingRef.current = null;
      setHeldBalance(null);
      setPhase('IDLE');
    },
  });

  const activePosition = straight.trim() !== '' ? `straight:${straight.trim()}` : position;

  const revealResult = () => {
    const settled = pendingRef.current;
    pendingRef.current = null;
    if (settled) {
      setLastWin(settled.win);
      setPhase('RESULT');
    }
    setHeldBalance(null);
    settle();
  };

  const spin = () => {
    setPhase('SPINNING');
    setPocket(null);
    setLastWin(null);
    pendingRef.current = null;
    setHeldBalance(balance.balance);
    bet('SPIN', {
      amount,
      currency: balance.currency,
      params: { bets: [{ position: activePosition, amount }] },
    });
  };

  return (
    <GameShell
      gameType="ROULETTE"
      title={t('games.roulette.name')}
      subtitle={t('games.roulette.subtitle')}
      stage={
        <>
          <RouletteCanvas
            phase={phase}
            pocket={pocket}
            onSpinComplete={revealResult}
            size={380}
          />
          {phase === 'RESULT' && pocket !== null && !busy && (
            <p
              className={`readout__note${lastWin ? '' : ''}`}
              role="status"
              style={{
                textAlign: 'center',
                marginTop: 10,
                color: lastWin ? 'var(--fg-accent)' : 'var(--fg-red)',
                fontWeight: 600,
              }}
            >
              {pocket} {pocketColor(pocket).toLowerCase()} —{' '}
              {lastWin ? 'you win' : 'no win'}
            </p>
          )}
        </>
      }
      panel={
        <>
          <div className="opt">
            <span className="opt__label">{t('game.outsideBets')}</span>
            <div className="opt__row">
              {POSITIONS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="opt__chip"
                  style={{ flexBasis: '30%' }}
                  aria-pressed={straight === '' && position === p.id}
                  disabled={busy}
                  onClick={() => {
                    setPosition(p.id);
                    setStraight('');
                  }}
                  title={`Pays ${p.pays}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="opt">
            <span className="opt__label">{t('gameUi.rouletteStraightUp')}</span>
            <input
              className="dash__input"
              inputMode="numeric"
              placeholder={t('game.pocketPlaceholder')}
              value={straight}
              disabled={busy}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, '').slice(0, 2);
                if (digits === '' || Number(digits) <= 36) setStraight(digits);
              }}
              aria-label={t('game.pocketNumber')}
            />
          </div>

          <div className="opt__stat">
            <span>{t('game.bettingOn')}</span>
            <b>{activePosition}</b>
          </div>

          <BetControls
            amount={amount}
            onAmountChange={setAmount}
            balance={heldBalance ?? balance.balance}
            currency={balance.currency}
            onBet={spin}
            busy={busy}
            disabled={busy}
            betLabel={t('game.spin')}
          />
        </>
      }
    />
  );
}
