import type { ChickenMode } from '@frigat/shared';
import type { MinesLayout } from '../engines/mines.engine';
import type { SeedContext } from '../types/engine.types';

export interface MinesState {
  userId: string;
  betTransactionId: string;
  betAmount: string;
  currency: string;
  layout: MinesLayout;
  seed: SeedContext;
  revealed: number[];
  active: boolean;
}

export interface ChickenState {
  userId: string;
  betTransactionId: string;
  betAmount: string;
  currency: string;
  mode: ChickenMode;
  seed: SeedContext;
  lane: number;
  maxLanes: number;
  bustLane: number | null;
  active: boolean;
}

export interface CrashBet {
  userId: string;
  betTransactionId: string;
  amount: string;
  currency: string;
  cashedOutAt?: number;
  settled: boolean;
}

class GameStateStore {
  private mines = new Map<string, MinesState>();
  private crashBets = new Map<string, CrashBet>();
  private chicken = new Map<string, ChickenState>();

  setMines(state: MinesState) {
    this.mines.set(state.userId, state);
  }
  getMines(userId: string): MinesState | undefined {
    return this.mines.get(userId);
  }
  clearMines(userId: string) {
    this.mines.delete(userId);
  }

  setChicken(state: ChickenState) {
    this.chicken.set(state.userId, state);
  }
  getChicken(userId: string): ChickenState | undefined {
    return this.chicken.get(userId);
  }
  clearChicken(userId: string) {
    this.chicken.delete(userId);
  }

  addCrashBet(bet: CrashBet) {
    this.crashBets.set(bet.userId, bet);
  }
  getCrashBet(userId: string): CrashBet | undefined {
    return this.crashBets.get(userId);
  }
  clearCrashBet(userId: string) {
    this.crashBets.delete(userId);
  }
  allCrashBets(): CrashBet[] {
    return [...this.crashBets.values()];
  }
}

export const gameState = new GameStateStore();
