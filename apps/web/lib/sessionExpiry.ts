'use client';

import { writeStoredToken } from '@/lib/token';

export function isUnauthorized(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { status?: unknown }).status;
  if (status === 401) return true;

  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') return false;
  const normalised = message.toLowerCase();
  return (
    normalised.includes('unauthorized') ||
    normalised.includes('unauthorised') ||
    normalised.includes('token expired') ||
    normalised.includes('invalid token') ||
    normalised.includes('jwt expired')
  );
}

let handling = false;

export function handleSessionExpiry(): void {
  if (typeof window === 'undefined' || handling) return;
  handling = true;

  writeStoredToken(null);
  void fetch('/api/session', { method: 'DELETE' }).catch(() => {});

  const next = `${window.location.pathname}${window.location.search}`;
  const target = `/login?error=invalid&next=${encodeURIComponent(next)}`;
  window.location.assign(target);
}

export function consumedAsSessionExpiry(error: unknown): boolean {
  if (!isUnauthorized(error)) return false;
  handleSessionExpiry();
  return true;
}
