'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { GameType } from '@frigat/shared/types';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import type { ClientActionType, ServerEventType } from '@/hooks/useSocket';

export interface GameResultFrame<TResult> {
  result: TResult | undefined;
  win: boolean;
  payout: string | null;
  raw: Record<string, unknown>;
}

export interface UseGameRoundOptions<TResult> {
  onResult?: (frame: GameResultFrame<TResult>) => void;
  onError?: (error: GameError) => void;
  autoSettle?: boolean;
  on?: Partial<Record<ServerEventType, (data: Record<string, unknown>) => void>>;
}

export interface GameError {
  code: string;
  message: string;
}

export function gameErrorKey(code: string): string {
  switch (code) {
    case 'INSUFFICIENT_FUNDS':
      return 'gameUi.errorFunds';
    case 'BET_LIMIT':
      return 'gameUi.errorLimit';
    case 'ACCOUNT_FROZEN':
      return 'gameUi.errorFrozen';
    case 'MAINTENANCE_MODE':
      return 'gameUi.errorMaintenance';
    case 'CASHOUT_LOCKED':
      return 'gameUi.errorCashLocked';
    case 'GAME_IN_PROGRESS':
    case 'ROUND_IN_PROGRESS':
      return 'gameUi.errorInProgress';
    default:
      return 'gameUi.errorGeneric';
  }
}

export interface UseGameRoundResult {
  busy: boolean;
  begin: () => void;
  settle: () => void;
  bet: (action: ClientActionType, payload: Record<string, unknown>) => void;
}

export function useGameRound<TResult = Record<string, unknown>>(
  gameType: GameType,
  options: UseGameRoundOptions<TResult> = {}
): UseGameRoundResult {
  const { socket, send } = useGameSocket();
  const { subscribe } = socket;

  const [busy, setBusy] = useState(false);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const extraEventsRef = useRef(Object.keys(options.on ?? {}) as ServerEventType[]);

  useEffect(() => {
    const off = [
      ...extraEventsRef.current.map((event) =>
        subscribe(event, (data) => {
          if (data.gameType !== undefined && data.gameType !== gameType) return;
          optionsRef.current.on?.[event]?.(data as Record<string, unknown>);
        })
      ),
      subscribe('GAME_RESULT', (data) => {
        if (data.gameType !== gameType) return;

        const { onResult, autoSettle = true } = optionsRef.current;
        onResult?.({
          result: data.resultData as TResult | undefined,
          win: Boolean(data.win),
          payout: typeof data.payout === 'string' ? data.payout : null,
          raw: data as Record<string, unknown>,
        });

        if (autoSettle) setBusy(false);
      }),
      subscribe('ERROR', (data) => {
        if (typeof data.gameType === 'string' && data.gameType !== gameType) return;
        setBusy(false);
        optionsRef.current.onError?.({
          code: typeof data.code === 'string' ? data.code : '',
          message: typeof data.message === 'string' ? data.message : '',
        });
      }),
    ];
    return () => off.forEach((fn) => fn());
  }, [subscribe, gameType]);

  const begin = useCallback(() => setBusy(true), []);
  const settle = useCallback(() => setBusy(false), []);

  const bet = useCallback(
    (action: ClientActionType, payload: Record<string, unknown>) => {
      setBusy(true);
      send(action, gameType, payload);
    },
    [send, gameType]
  );

  return { busy, begin, settle, bet };
}

export default useGameRound;
