'use client';

import { useEffect, useMemo, useState } from 'react';

import LiveBetsFeed from '@/components/feed/LiveBetsFeed';
import { useLanguage } from '@/components/providers/LanguageProvider';

const JACKPOT_SEED = {
  grand: 184_000,
  major: 21_400,
  minor: 2_180,
} as const;

const DRIFT_PER_SECOND = {
  grand: 0.02,
  major: 0.008,
  minor: 0.003,
} as const;

const TIERS = [
  { id: 'grand', label: 'Grand', tone: 'grand' },
  { id: 'major', label: 'Major', tone: 'major' },
  { id: 'minor', label: 'Minor', tone: 'minor' },
] as const;


function useJackpots() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return useMemo(
    () =>
      TIERS.map((tier) => ({
        ...tier,
        value: JACKPOT_SEED[tier.id] + DRIFT_PER_SECOND[tier.id] * elapsed,
      })),
    [elapsed]
  );
}

export function JackpotDock() {
  const jackpots = useJackpots();
  const { t } = useLanguage();



  return (
    <aside className="dock" aria-label={t('feed.jackpotsAria')}>
      <section className="dock__panel">
        <h2 className="dock__title">{t('feed.jackpots')}</h2>
        <div className="dock__jackpots">
          {jackpots.map((tier) => (
            <div key={tier.id} className={`dock__jp dock__jp--${tier.tone}`}>
              <span className="dock__jp-label">{tier.label}</span>
              <b className="dock__jp-value">
                ${tier.value.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </b>
            </div>
          ))}
        </div>
      </section>

      <LiveBetsFeed compact />
    </aside>
  );
}

export default JackpotDock;
