'use client';

import { useState } from 'react';

import { PLINKO_ROWS, PLINKO_TABLES, type PlinkoRisk } from '@frigat/shared/constants';

import { PlinkoCanvas, type PlinkoDrop } from '@/components/canvas/PlinkoCanvas';
import { BetControls } from '@/components/games/BetControls';
import { GameShell } from '@/components/games/GameShell';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useGameRound } from '@/hooks/useGameRound';

const RISKS: PlinkoRisk[] = ['LOW', 'MEDIUM', 'HIGH'];

export default function PlinkoPage() {
  const { balance } = useGameSocket();
  const { t } = useLanguage();

  const [amount, setAmount] = useState('1.00');
  const [rows, setRows] = useState<number>(12);
  const [risk, setRisk] = useState<PlinkoRisk>('MEDIUM');
  const [drops, setDrops] = useState<PlinkoDrop[]>([]);

  const { busy, bet, settle } = useGameRound<{
    path?: Array<'L' | 'R'>;
    bucket?: number;
    rows?: number;
  }>('PLINKO', {
    autoSettle: false,
    onResult: ({ result, raw }) => {
      if (!Array.isArray(result?.path)) {
        settle();
        return;
      }
      const id =
        typeof raw.sessionId === 'string'
          ? raw.sessionId
          : `drop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setDrops((prev) => [
        ...prev.slice(-5),
        {
          id,
          path: result.path!,
          bucket: result.bucket,
          multiplier: typeof raw.multiplier === 'number' ? raw.multiplier : undefined,
        },
      ]);
    },
  });

  const multipliers = PLINKO_TABLES[risk][rows] ?? [];

  return (
    <GameShell
      gameType="PLINKO"
      title={t('games.plinko.name')}
      subtitle={`${rows} rows · ${risk.toLowerCase()} risk`}
      stage={
        <PlinkoCanvas
          rows={rows}
          multipliers={multipliers}
          drops={drops}
          height={440}
          onDropComplete={settle}
        />
      }
      panel={
        <>
          <div className="opt">
            <span className="opt__label">{t('game.rows')}</span>
            <div className="opt__row">
              {PLINKO_ROWS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="opt__chip"
                  aria-pressed={rows === option}
                  disabled={busy}
                  onClick={() => {
                    setRows(option);
                    setDrops([]);
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="opt">
            <span className="opt__label">{t('game.risk')}</span>
            <div className="opt__row">
              {RISKS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="opt__chip"
                  aria-pressed={risk === option}
                  disabled={busy}
                  onClick={() => {
                    setRisk(option);
                    setDrops([]);
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="opt__stat">
            <span>{t('game.topMultiplier')}</span>
            <b>{multipliers.length ? `${Math.max(...multipliers)}×` : '—'}</b>
          </div>

          <BetControls
            amount={amount}
            onAmountChange={setAmount}
            balance={balance.balance}
            currency={balance.currency}
            onBet={() =>
              bet('BET', {
                amount,
                currency: balance.currency,
                params: { rows, risk },
              })
            }
            busy={busy}
            betLabel={t('game.dropBall')}
          />
        </>
      }
    />
  );
}
