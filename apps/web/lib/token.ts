'use client';

export const TOKEN_STORAGE_KEY = 'token';

const LEGACY_TOKEN_KEY = 'frigat.token';

const LOCAL_CHANGE_EVENT = 'frigat:token';

export function readStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const current = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (current) return current;

    const legacy = window.localStorage.getItem(LEGACY_TOKEN_KEY);
    if (legacy) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, legacy);
      window.localStorage.removeItem(LEGACY_TOKEN_KEY);
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeStoredToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
  }
  window.dispatchEvent(new CustomEvent(LOCAL_CHANGE_EVENT));
}

export function subscribeToToken(onChange: (token: string | null) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== TOKEN_STORAGE_KEY) return;
    onChange(readStoredToken());
  };
  const handleLocal = () => onChange(readStoredToken());

  window.addEventListener('storage', handleStorage);
  window.addEventListener(LOCAL_CHANGE_EVENT, handleLocal);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(LOCAL_CHANGE_EVENT, handleLocal);
  };
}

export { API_URL } from '@/lib/endpoints';
