'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useLanguage } from '@/components/providers/LanguageProvider';
import { CATALOGUE, type CatalogueEntry } from '@/lib/gameCatalogue';

export interface SearchMatch {
  entry: CatalogueEntry;
  name: string;
}

interface SearchContextValue {
  query: string;
  setQuery: (next: string) => void;
  clear: () => void;
  matches: SearchMatch[];
  isSearching: boolean;
}

const SearchContext = createContext<SearchContextValue | null>(null);

function normalise(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function SearchProvider({ children }: { children: ReactNode }) {
  const { t, locale } = useLanguage();
  const [query, setQuery] = useState('');

  const clear = useCallback(() => setQuery(''), []);

  const matches = useMemo(() => {
    const needle = normalise(query);
    const all = CATALOGUE.map((entry) => ({
      entry,
      name: t(`games.${entry.slug}.name`),
    }));
    if (!needle) return all;
    return all.filter(
      ({ entry, name }) =>
        normalise(name).includes(needle) || normalise(entry.slug).includes(needle)
    );
  }, [query, t, locale]);

  const value = useMemo<SearchContextValue>(
    () => ({
      query,
      setQuery,
      clear,
      matches,
      isSearching: query.trim().length > 0,
    }),
    [query, clear, matches]
  );

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch(): SearchContextValue {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('useSearch must be used inside <SearchProvider>');
  }
  return context;
}
