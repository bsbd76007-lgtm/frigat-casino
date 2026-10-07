import { formatDecimalString, fromUnits, toUnits } from '@/lib/decimal';

export interface LiveBet {
  id: string;
  userId: string;
  username: string;
  gameType: string;
  betAmount: string;
  multiplier: number;
  payout: string;
  timestamp: number;
}

export interface BetFairness {
  hashedServerSeed: string;
  serverSeed: string | null;
  revealed: boolean;
  clientSeed: string;
  nonce: number;
}

export interface BetDetail extends LiveBet {
  fairness: BetFairness;
}

export function betProfit(bet: Pick<LiveBet, 'betAmount' | 'payout'>): string {
  return fromUnits(toUnits(bet.payout) - toUnits(bet.betAmount));
}

export function isWin(bet: Pick<LiveBet, 'betAmount' | 'payout'>): boolean {
  return toUnits(bet.payout) > toUnits(bet.betAmount);
}

export function formatSignedUsd(amount: string, locale?: string): string {
  const negative = amount.startsWith('-');
  const unsigned = negative ? amount.slice(1) : amount;
  return `${negative ? '-' : ''}$${formatDecimalString(unsigned, 2, locale)}`;
}

export function formatUsd(amount: string, locale?: string): string {
  return `$${formatDecimalString(amount.replace(/^-/, ''), 2, locale)}`;
}

export function formatMultiplier(multiplier: number, locale?: string): string {
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(multiplier)}×`;
}

export function formatBetTimestamp(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} в ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
