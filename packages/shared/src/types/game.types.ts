export type GameType =
  | 'CRASH'
  | 'MINES'
  | 'ROULETTE'
  | 'COINFLIP'
  | 'PLINKO'
  | 'DICE'
  | 'LIMBO'
  | 'KENO'
  | 'CHICKEN'
  | 'AVIA'
  | 'SLOTS';

export type UserRole = 'USER' | 'ADMIN';

export type TransactionType =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'BET'
  | 'WIN'
  | 'AFFILIATE_REWARD';

export type TransactionStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface User {
  id: string;
  telegramId?: string | null;
  email: string;
  role: UserRole;
  createdAt: Date | string;
}

export interface Wallet {
  id: string;
  userId: string;
  balance: string;
  affiliateBalance: string;
  currency: string;
  updatedAt: Date | string;
}

export interface Transaction {
  id: string;
  walletId: string;
  type: TransactionType;
  amount: string;
  status: TransactionStatus;
  txHash?: string | null;
  createdAt: Date | string;
}

export interface BetRequest {
  gameType: GameType;
  amount: string;
  currency: string;
  clientSeed: string;
  params?: Record<string, unknown>;
}

export interface BetResult {
  sessionId: string;
  gameType: GameType;
  betAmount: string;
  payout: string;
  multiplier: number;
  win: boolean;
  resultData: Record<string, unknown>;
  hashedServerSeed: string;
  clientSeed: string;
  nonce: number;
  balance: string;
  createdAt: Date | string;
}

export interface ProvableSeedPair {
  id: string;
  userId: string;
  serverSeed?: string | null;
  hashedServerSeed: string;
  clientSeed: string;
  nonce: number;
  active: boolean;
}
