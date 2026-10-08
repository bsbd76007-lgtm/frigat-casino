'use client';


import { useRef, useState } from 'react';

import { CoinflipCanvas, type CoinFlight } from '@/components/canvas/CoinflipCanvas';
import { BetControls } from '@/components/games/BetControls';
import { GameShell } from '@/components/games/GameShell';
import { RoundResult } from '@/components/games/RoundResult';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useGameRound } from '@/hooks/useGameRound';

type CoinSide = 'HEADS' | 'TAILS';

const COIN_PAYS = 1.98;

interface Flip extends CoinFlight {
  payout: string | null;
  pick: CoinSide;
}

const other = (side: CoinSide): CoinSide => (side === 'HEADS' ? 'TAILS' : 'HEADS');

export default function CoinflipPage() {
  const { balance } = useGameSocket();
  const { t } = useLanguage();

  const [amount, setAmount] = useState('1.00');
  const [side, setSide] = useState<CoinSide>('HEADS');
  const [flip, setFlip] = useState<Flip | null>(null);
  const [complete, setComplete] = useState(false);

  const roundSeq = useRef(0);

  const { busy, bet, settle } = useGameRound<{ landed?: CoinSide }>('COINFLIP', {
    autoSettle: false,
    onResult: ({ result, win, payout: paid }) => {
      roundSeq.current += 1;
      setComplete(false);
      setFlip({
        id: `coin-${roundSeq.current}`,
        landed: result?.landed ?? (win ? side : other(side)),
        win,
        payout: paid,
        pick: side,
      });
    },
  });

  const placeBet = () => {
    setFlip(null);
    setComplete(false);
    bet('SPIN', {
      amount,
      currency: balance.currency,
      params: { side },
    });
  };

  return (
    <GameShell
      gameType="COINFLIP"
      title={t('games.coinflip.name')}
      subtitle={t('games.coinflip.subtitle')}
      stage={
        <div className="stage__center">
          <div style={{ width: '100%', maxWidth: 480 }}>
            <CoinflipCanvas
              pick={side}
              spinning={busy && flip === null}
              flight={flip}
              onLanded={() => {
                setComplete(true);
                settle();
              }}
            />
          </div>

          {complete && flip && (
            <RoundResult
              key={flip.id}
              win={flip.win}
              payout={flip.payout}
              currency={balance.currency}
              multiplier={flip.win ? COIN_PAYS : null}
              detail={t('result.coin', {
                landed: t(flip.landed === 'HEADS' ? 'result.heads' : 'result.tails'),
                pick: t(flip.pick === 'HEADS' ? 'result.heads' : 'result.tails'),
              })}
            />
          )}
        </div>
      }
      panel={
        <>
          <div className="opt">
            <span className="opt__label">{t('game.yourSide')}</span>
            <div className="opt__row">
              {(['HEADS', 'TAILS'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className="opt__chip"
                  aria-pressed={side === option}
                  disabled={busy}
                  onClick={() => setSide(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="opt__stat">
            <span>{t('game.payoutOnWin')}</span>
            <b>{COIN_PAYS.toFixed(2)}×</b>
          </div>

          <BetControls
            amount={amount}
            onAmountChange={setAmount}
            balance={balance.balance}
            currency={balance.currency}
            onBet={placeBet}
            busy={busy}
            disabled={busy}
            betLabel={t('game.flip')}
          />
        </>
      }
    />
  );
}
