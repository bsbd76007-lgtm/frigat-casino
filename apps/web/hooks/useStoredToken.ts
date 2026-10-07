'use client';

import { useEffect, useState } from 'react';

import { readStoredToken, subscribeToToken } from '@/lib/token';

export function useStoredToken(): string | null {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    setToken(readStoredToken());
    return subscribeToToken(setToken);
  }, []);

  return token;
}

export default useStoredToken;
