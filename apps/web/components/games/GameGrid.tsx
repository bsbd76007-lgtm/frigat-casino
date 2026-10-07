'use client';

import { useLanguage } from '@/components/providers/LanguageProvider';
import { useSearch } from '@/components/providers/SearchProvider';
import { GameCard } from '@/components/games/GameCard';
import { GameShelf } from '@/components/games/GameShelf';

import {
  SECTIONS,
  gamesIn,
  type CatalogueEntry,
  type GameCategory,
} from '@/lib/gameCatalogue';

interface GameGridProps {
  category: GameCategory;
  onLaunch?: (entry: CatalogueEntry) => void;
  onCategoryChange?: (category: GameCategory) => void;
}

export function GameGrid({ category, onLaunch, onCategoryChange }: GameGridProps) {
  const { t } = useLanguage();
  const { matches, isSearching } = useSearch();

  if (isSearching) {
    if (matches.length === 0) {
      return <p className="grid__empty">{t('search.empty')}</p>;
    }
    return (
      <div className="grid">
        {matches.map(({ entry }) => (
          <GameCard key={entry.slug} entry={entry} onLaunch={onLaunch} />
        ))}
      </div>
    );
  }

  if (category === 'all') {
    const rows = SECTIONS.map((section) => ({
      ...section,
      games: gamesIn(section.id),
    })).filter((section) => section.games.length > 0);

    return (
      <div className="shelves">
        {rows.map((section, index) => (
          <GameShelf
            key={section.id}
            title={t(section.titleKey)}
            games={section.games}
            category={section.id}
            onLaunch={onLaunch}
            onSeeAll={onCategoryChange}
            size={index === 0 ? 'lead' : 'default'}
          />
        ))}
      </div>
    );
  }

  const games = gamesIn(category);
  if (games.length === 0) {
    return <p className="grid__empty">{t('home.filters.empty')}</p>;
  }

  return (
    <div className="grid">
      {games.map((entry) => (
        <GameCard key={entry.slug} entry={entry} onLaunch={onLaunch} />
      ))}
    </div>
  );
}

export default GameGrid;
