'use client';

import Image from 'next/image';
import Link from 'next/link';

import { GAME_ICONS } from '@/components/icons';
import { GAME_POSTERS } from '@/components/games/GamePoster';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useFavorites } from '@/context/FavoritesContext';

import { openPanel } from '@/lib/appPanels';
import { GAME_ART, type CatalogueEntry } from '@/lib/gameCatalogue';

interface GameCardProps {
  entry: CatalogueEntry;
  onLaunch?: (entry: CatalogueEntry) => void;
}

export function GameCard({ entry, onLaunch }: GameCardProps) {
  const { slug, badge } = entry;
  const { t } = useLanguage();
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorite = isFavorite(slug);
  const Icon = GAME_ICONS[slug];
  const href = `/games/${slug}`;
  const art = GAME_ART[slug];
  const name = t(`games.${slug}.name`);
  const Poster = GAME_POSTERS[slug];

  const intercept = (event: React.MouseEvent) => {
    if (!onLaunch) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.button !== 0) return;
    event.preventDefault();
    onLaunch(entry);
  };

  return (
    <article className="tile">

      <button
        type="button"
        className={favorite ? 'tile__fav tile__fav--on' : 'tile__fav'}
        aria-pressed={favorite}
        aria-label={t(favorite ? 'favorites.remove' : 'favorites.add', { game: name })}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleFavorite(slug);
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            d="M12 20.5 4.6 13.3a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9a4.6 4.6 0 1 1 6.5 6.5Z"
            fill={favorite ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {badge && (
        <span className={`tile__badge tile__badge--${badge}`}>
          {t(`home.badge.${badge}`)}
        </span>
      )}

      <span className="tile__art">
        {Poster ? (
          <Poster name={name} />
        ) : art ? (
          <Image
            src={art}
            alt=""
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 220px"
            className="tile__img"
          />
        ) : (
          <span className="tile__fallback">
            <Icon size={54} />
            <span className="tile__fallback-name">{name}</span>
          </span>
        )}

        <div className="tile__overlay">
          <Link className="tile__play" href={href} onClick={intercept}>
            {t('home.playNow')}
          </Link>
          <button
            type="button"
            className="tile__demo"
            onClick={() => openPanel('fairness')}
          >
            {t('home.howItWorks')}
          </button>
        </div>
      </span>

      <span className="tile__body">
        <span className="tile__blurb">{t(`games.${slug}.blurb`)}</span>
      </span>


      <Link
        className="tile__link"
        href={href}
        onClick={intercept}
        aria-label={name}
      />
    </article>
  );
}

export default GameCard;
