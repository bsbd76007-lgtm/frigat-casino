'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { formatDecimalString, isDecimalString } from '@/lib/decimal';
import type { ServerEventType, UseSocketResult } from '@/hooks/useSocket';
export { formatDecimalString };

const BALANCE_BEARING_EVENTS: ServerEventType[] = [
  'BALANCE',
  'BET_ACCEPTED',
  'GAME_RESULT',
];

export interface UseBalanceOptions {
  initialBalance?: string | null;
  currency?: string;
  fractionDigits?: number;
  locale?: string;
}

export interface UseBalanceResult {
  balance: string | null;
  previousBalance: string | null;
  formatted: string;
  currency: string;
  hasSynced: boolean;
  lastUpdatedAt: number | null;
  reset: () => void;
}

export function useBalance(
  socket: Pick<UseSocketResult, 'subscribe'>,
  options: UseBalanceOptions = {}
): UseBalanceResult {
  const {
    initialBalance = null,
    currency = 'USD',
    fractionDigits = 2,
    locale,
  } = options;

  const [balance, setBalance] = useState<string | null>(initialBalance);
  const [previousBalance, setPreviousBalance] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [hasSynced, setHasSynced] = useState(false);

  const { subscribe } = socket;

  const balanceRef = useRef<string | null>(initialBalance);
  balanceRef.current = balance;

  useEffect(() => {
    const handler = (data: Record<string, unknown>) => {
      const next = data?.balance;
      if (typeof next !== 'string' || !isDecimalString(next)) return;

      setHasSynced(true);
      if (next === balanceRef.current) return;

      setPreviousBalance(balanceRef.current);
      balanceRef.current = next;
      setBalance(next);
      setLastUpdatedAt(Date.now());
    };

    const unsubscribers = BALANCE_BEARING_EVENTS.map((event) =>
      subscribe(event, handler)
    );
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [subscribe]);

  const reset = useCallback(() => {
    balanceRef.current = null;
    setBalance(null);
    setPreviousBalance(null);
    setLastUpdatedAt(null);
    setHasSynced(false);
  }, []);

  const formatted = useMemo(
    () =>
      balance === null
        ? formatDecimalString('0', fractionDigits, locale)
        : formatDecimalString(balance, fractionDigits, locale),
    [balance, fractionDigits, locale]
  );

  return useMemo(
    () => ({
      balance,
      previousBalance,
      formatted,
      currency,
      hasSynced,
      lastUpdatedAt,
      reset,
    }),
    [balance, previousBalance, formatted, currency, hasSynced, lastUpdatedAt, reset]
  );
}

export default useBalance;
