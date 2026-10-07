'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { CATALOGUE, type CatalogueEntry } from '@/lib/gameCatalogue';

const STORAGE_KEY = 'frigat.favorites';

export type GameId = CatalogueEntry['slug'];

interface FavoritesContextValue {
  favorites: GameId[];
  isFavorite: (gameId: string) => boolean;
  toggleFavorite: (gameId: string) => void;
  clearFavorites: () => void;
  favoriteGames: CatalogueEntry[];
  count: number;
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

const KNOWN = new Set<string>(CATALOGUE.map((entry) => entry.slug));

function isKnownGame(id: unknown): id is GameId {
  return typeof id === 'string' && KNOWN.has(id);
}

function read(): GameId[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isKnownGame) : [];
  } catch {
    return [];
  }
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<GameId[]>([]);

  useEffect(() => setFavorites(read()), []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      setFavorites(read());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const persist = useCallback((next: GameId[]) => {
    setFavorites(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
    }
  }, []);

  const isFavorite = useCallback(
    (gameId: string) => favorites.includes(gameId as GameId),
    [favorites]
  );

  const toggleFavorite = useCallback(
    (gameId: string) => {
      if (!isKnownGame(gameId)) return;
      setFavorites((current) => {
        const next = current.includes(gameId)
          ? current.filter((id) => id !== gameId)
          : [...current, gameId];
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
        }
        return next;
      });
    },
    []
  );

  const clearFavorites = useCallback(() => persist([]), [persist]);

  const favoriteGames = useMemo(
    () => CATALOGUE.filter((entry) => favorites.includes(entry.slug)),
    [favorites]
  );

  const value = useMemo<FavoritesContextValue>(
    () => ({
      favorites,
      isFavorite,
      toggleFavorite,
      clearFavorites,
      favoriteGames,
      count: favorites.length,
    }),
    [favorites, isFavorite, toggleFavorite, clearFavorites, favoriteGames]
  );

  return (
    <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>
  );
}

export function useFavorites(): FavoritesContextValue {
  const context = useContext(FavoritesContext);
  if (!context) {
    throw new Error('useFavorites must be used inside <FavoritesProvider>');
  }
  return context;
}
