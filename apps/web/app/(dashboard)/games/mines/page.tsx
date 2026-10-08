'use client';

import { useEffect, useState } from 'react';

import { MINES } from '@frigat/shared/constants';

import { MinesCanvas } from '@/components/canvas/MinesCanvas';
import { BetControls } from '@/components/games/BetControls';
import { GameShell } from '@/components/games/GameShell';
import { RoundResult } from '@/components/games/RoundResult';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { gameErrorKey, useGameRound } from '@/hooks/useGameRound';

const MINE_OPTIONS = [5, 10, 15, 20, 24];

export default function MinesPage() {
  const { balance, send, socket } = useGameSocket();
  const { t } = useLanguage();

  const [amount, setAmount] = useState('1.00');
  const [minesCount, setMinesCount] = useState<number>(MINES.minMines);
  const [active, setActive] = useState(false);
  const [revealed, setRevealed] = useState<number[]>([]);
  const [multiplier, setMultiplier] = useState(1);
  const [potentialPayout, setPotentialPayout] = useState<string | null>(null);
  const [minePositions, setMinePositions] = useState<number[]>([]);
  const [hitTile, setHitTile] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<'bust' | 'cashout' | null>(null);
  const [cashedOut, setCashedOut] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { busy, begin, settle, bet } = useGameRound('MINES', {
    on: {
      BET_ACCEPTED: (data) => {
        const resumed = data.resumed === true;
        setActive(true);
        setError(null);
        setRevealed(resumed && Array.isArray(data.revealed) ? (data.revealed as number[]) : []);
        setMultiplier(resumed && typeof data.multiplier === 'number' ? data.multiplier : 1);
        setPotentialPayout(
          resumed && typeof data.potentialPayout === 'string' ? data.potentialPayout : null
        );
        if (resumed && typeof data.minesCount === 'number') setMinesCount(data.minesCount);
        if (resumed && typeof data.amount === 'string') setAmount(data.amount);
        setMinePositions([]);
        setHitTile(null);
        setOutcome(null);
        setCashedOut(null);
        settle();
      },
      STATE_UPDATE: (data) => {
        if (typeof data.revealedTile === 'number') {
          setRevealed((prev) =>
            prev.includes(data.revealedTile as number)
              ? prev
              : [...prev, data.revealedTile as number]
          );
        }
        if (typeof data.multiplier === 'number') setMultiplier(data.multiplier);
        if (typeof data.potentialPayout === 'string') {
          setPotentialPayout(data.potentialPayout);
        }
        settle();
      },
    },
    onError: ({ code }) => {
      setError(t(gameErrorKey(code)));
      if (code === 'GAME_IN_PROGRESS') send('RESUME', 'MINES');
      if (code === 'NO_ACTIVE_GAME') setActive(false);
    },
    onResult: ({ raw, payout }) => {
      setActive(false);
      setCashedOut(payout);
      if (Array.isArray(raw.minePositions)) {
        setMinePositions(raw.minePositions as number[]);
      }
      if (raw.bust) {
        setOutcome('bust');
        if (typeof raw.hitTile === 'number') setHitTile(raw.hitTile);
      } else {
        setOutcome('cashout');
        if (typeof raw.multiplier === 'number') setMultiplier(raw.multiplier);
        if (Array.isArray(raw.revealed)) setRevealed(raw.revealed as number[]);
      }
    },
  });

  useEffect(() => {
    if (!socket.isOpen) return;
    send('RESUME', 'MINES');
  }, [socket.isOpen, send]);

  const reveal = (tile: number) => {
    if (!active || revealed.includes(tile) || busy) return;
    begin();
    send('REVEAL_TILE', 'MINES', { tile });
  };

  return (
    <GameShell
      gameType="MINES"
      title={t('games.mines.name')}
      subtitle={`${MINES.gridSize} tiles · reveal safe tiles and cash out`}
      stage={
        <>
          <MinesCanvas
            gridSize={MINES.gridSize}
            revealed={revealed}
            minePositions={minePositions}
            hitTile={hitTile}
            interactive={active && !busy}
            onReveal={reveal}
            ariaLabel={t('game.minesBoard')}
          />

          {outcome && (
            <RoundResult
              win={outcome === 'cashout'}
              bust={outcome === 'bust'}
              title={outcome === 'cashout' ? t('result.cashedOut') : undefined}
              payout={outcome === 'cashout' ? cashedOut : null}
              currency={balance.currency}
              multiplier={outcome === 'cashout' ? multiplier : null}
              detail={
                outcome === 'bust'
                  ? t('result.minesBust')
                  : t('result.minesCash', { tiles: revealed.length })
              }
            />
          )}
        </>
      }
      panel={
        <>
          <div className="opt">
            <span className="opt__label">{t('game.mines')}</span>
            <div className="opt__row">
              {MINE_OPTIONS.map((count) => (
                <button
                  key={count}
                  type="button"
                  className="opt__chip"
                  aria-pressed={minesCount === count}
                  disabled={active}
                  onClick={() => setMinesCount(count)}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>

          <div className="opt">
            <div className="opt__stat">
              <span>{t('game.revealed')}</span>
              <b>{revealed.length}</b>
            </div>
            <div className="opt__stat">
              <span>{t('game.multiplier')}</span>
              <b>{multiplier.toFixed(2)}×</b>
            </div>
            <div className="opt__stat">
              <span>{t('game.cashoutValue')}</span>
              <b>{potentialPayout ?? '—'}</b>
            </div>
          </div>

          {error && (
            <p className="game__banner" role="alert">
              {error}
            </p>
          )}

          <BetControls
            amount={amount}
            onAmountChange={setAmount}
            balance={balance.balance}
            currency={balance.currency}
            canCashout={active && revealed.length > 0}
            cashoutAmount={potentialPayout}
            cashoutMultiplier={multiplier}
            onBet={() => {
              setError(null);
              bet('BET', {
                amount,
                currency: balance.currency,
                params: { minesCount },
              });
            }}
            onCashout={() => {
              begin();
              send('CASHOUT', 'MINES');
            }}
            disabled={active && revealed.length === 0}
            busy={busy}
            betLabel={active ? t('game.roundInProgress') : t('game.startRound')}
          />
        </>
      }
    />
  );
}
