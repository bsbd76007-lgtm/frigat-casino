import { randomUUID } from 'crypto';
import { CRASH } from '../config/game.config';
import { multiplierAtElapsed } from '../engines/crash.engine';
import type { SeedContext } from '../types/engine.types';

export type CrashPhase = 'IDLE' | 'RUNNING' | 'CRASHED';

export interface CrashRound {
  userId: string;
  roundId: string;
  seed: SeedContext;
  crashPoint: number;
  startedAt: number;
  currentMultiplier: number;
}

type TickHandler = (round: CrashRound) => void;
type BustHandler = (round: CrashRound) => Promise<void> | void;

export class CrashRoundManager {
  private rounds = new Map<string, CrashRound>();
  private timers = new Map<string, NodeJS.Timeout>();
  private onTick: TickHandler;
  private onBust: BustHandler;

  constructor(onTick: TickHandler, onBust: BustHandler) {
    this.onTick = onTick;
    this.onBust = onBust;
  }

  get(userId: string): CrashRound | null {
    return this.rounds.get(userId) ?? null;
  }

  isRunning(userId: string): boolean {
    return this.rounds.has(userId);
  }

  phaseFor(userId: string): CrashPhase {
    return this.rounds.has(userId) ? 'RUNNING' : 'IDLE';
  }

  activeRoundCount(): number {
    return this.rounds.size;
  }

  liveMultiplier(userId: string): number {
    const round = this.rounds.get(userId);
    if (!round) return 1;
    return multiplierAtElapsed(Date.now() - round.startedAt);
  }

  start(userId: string, seed: SeedContext, crashPoint: number): CrashRound {
    this.end(userId);

    const round: CrashRound = {
      userId,
      roundId: randomUUID(),
      seed,
      crashPoint,
      startedAt: Date.now(),
      currentMultiplier: 1,
    };

    this.rounds.set(userId, round);
    this.timers.set(
      userId,
      setInterval(() => this.tick(userId), CRASH.tickMs)
    );

    return round;
  }

  end(userId: string): CrashRound | null {
    const timer = this.timers.get(userId);
    if (timer) clearInterval(timer);
    this.timers.delete(userId);

    const round = this.rounds.get(userId) ?? null;
    this.rounds.delete(userId);
    return round;
  }

  stopAll() {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    this.rounds.clear();
  }

  private tick(userId: string) {
    const round = this.rounds.get(userId);
    if (!round) return;

    const m = multiplierAtElapsed(Date.now() - round.startedAt);

    if (m >= round.crashPoint) {
      round.currentMultiplier = round.crashPoint;
      this.end(userId);
      void this.onBust(round);
      return;
    }

    round.currentMultiplier = m;
    this.onTick(round);
  }
}
