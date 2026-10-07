'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { GameCard } from '@/components/games/GameCard';
import { useLanguage } from '@/components/providers/LanguageProvider';

import type { CatalogueEntry, GameCategory } from '@/lib/gameCatalogue';

interface GameShelfProps {
  title: string;
  games: readonly CatalogueEntry[];
  category: GameCategory;
  onLaunch?: (entry: CatalogueEntry) => void;
  onSeeAll?: (category: GameCategory) => void;
  size?: 'lead' | 'default';
}

export function GameShelf({
  title,
  games,
  category,
  onLaunch,
  onSeeAll,
  size = 'default',
}: GameShelfProps) {
  const { t } = useLanguage();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [canScroll, setCanScroll] = useState({ back: false, forward: false });

  const measure = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanScroll({
      back: el.scrollLeft > 1,
      forward: el.scrollLeft < max - 1,
    });
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [measure, games.length]);

  const page = (direction: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  if (games.length === 0) return null;

  const shelfClass = size === 'lead' ? 'shelf shelf--lead' : 'shelf';

  return (
    <section className={shelfClass}>
      <header className="shelf__head">
        <h2 className="shelf__title">{title}</h2>

        <div className="shelf__tools">
          {onSeeAll && (
            <button
              type="button"
              className="shelf__all"
              onClick={() => onSeeAll(category)}
            >
              {t('home.seeAll')}
            </button>
          )}

          <div className="shelf__arrows" aria-hidden="true">
            <button
              type="button"
              className="shelf__arrow"
              disabled={!canScroll.back}
              tabIndex={-1}
              onClick={() => page(-1)}
            >
              <svg viewBox="0 0 24 24" width="15" height="15">
                <path
                  d="M15 5 8 12l7 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className="shelf__arrow"
              disabled={!canScroll.forward}
              tabIndex={-1}
              onClick={() => page(1)}
            >
              <svg viewBox="0 0 24 24" width="15" height="15">
                <path
                  d="m9 5 7 7-7 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div
        ref={trackRef}
        className={
          canScroll.forward ? 'shelf__track shelf__track--more' : 'shelf__track'
        }
        tabIndex={0}
        role="group"
        aria-label={title}
      >
        {games.map((entry) => (
          <div className="shelf__cell" key={entry.slug}>
            <GameCard entry={entry} onLaunch={onLaunch} />
          </div>
        ))}
      </div>
    </section>
  );
}

export default GameShelf;
