import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';

import { identityFromRequest } from '../../middleware/auth';
import { prisma } from '../../config/prisma';
import {
  processBet,
  processWin,
  InsufficientFundsError,
  WalletNotFoundError,
  AccountFrozenError,
} from '../../services/ledger.service';
import { nextSeedContext } from '../../services/provableFair.service';
import { capPayout } from '../../services/riskConfig.service';
import { pushBalanceToUser } from '../../websocket/socket.server';
import { spin } from '../../engines/slots.engine';
import {
  BET_LIMITS,
  SLOTS_PAYLINES,
  SLOTS_PAYLINE_NAMES,
  SLOTS_PAYTABLE,
  SLOTS_REELS,
  SLOTS_ROWS,
  SLOTS_SYMBOLS,
} from '../../config/game.config';

const D = Prisma.Decimal;
const GAME_TYPE = 'SLOTS';

interface SpinBody {
  betAmount?: number | string;
  currency?: string;
}

function parseStake(raw: unknown): { amount: string } | { error: string } {
  if (raw === undefined || raw === null || raw === '') {
    return { error: 'betAmount is required' };
  }
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    return { error: 'betAmount must be a number' };
  }
  if (typeof raw === 'number' && !Number.isFinite(raw)) {
    return { error: 'betAmount must be a finite number' };
  }

  let amount: Prisma.Decimal;
  try {
    amount = new D(raw);
  } catch {
    return { error: 'betAmount must be a number' };
  }
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
    return { error: 'betAmount must be greater than zero' };
  }
  if (amount.lessThan(new D(BET_LIMITS.min))) {
    return { error: `betAmount is below the minimum of ${BET_LIMITS.min}` };
  }
  if (amount.greaterThan(new D(BET_LIMITS.max))) {
    return { error: `betAmount is above the maximum of ${BET_LIMITS.max}` };
  }

  return { amount: amount.toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN).toString() };
}

export function registerSlotsRoutes(app: FastifyInstance) {
  app.get('/api/games/slots/config', async () => ({
    reels: SLOTS_REELS,
    rows: SLOTS_ROWS,
    symbols: SLOTS_SYMBOLS,
    paytable: SLOTS_PAYTABLE,
    paylines: SLOTS_PAYLINES,
    paylineNames: SLOTS_PAYLINE_NAMES,
    betLimits: BET_LIMITS,
  }));

  app.post<{ Body: SpinBody }>('/api/games/slots/spin', async (req, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });

    const stake = parseStake(req.body?.betAmount);
    if ('error' in stake) {
      return reply.code(400).send({ error: 'invalid_bet', message: stake.error });
    }
    const { amount } = stake;
    const currency = typeof req.body?.currency === 'string' ? req.body.currency : 'USD';
    const { userId } = identity;

    let bet;
    try {
      bet = await processBet({ userId, amount, gameType: GAME_TYPE, currency });
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        return reply
          .code(402)
          .send({ error: 'insufficient_funds', message: 'Not enough balance for this bet' });
      }
      if (err instanceof AccountFrozenError) {
        return reply
          .code(403)
          .send({ error: 'account_frozen', message: 'This account cannot place bets' });
      }
      if (err instanceof WalletNotFoundError) {
        return reply
          .code(404)
          .send({ error: 'wallet_not_found', message: 'No wallet for this currency' });
      }
      req.log.warn({ err, userId }, 'slots: bet rejected');
      return reply.code(400).send({
        error: 'bet_rejected',
        message: err instanceof Error ? err.message : 'Bet rejected',
      });
    }

    const seed = await nextSeedContext(userId);
    const result = spin({}, seed);
    const resultData = result.resultData as {
      reelMatrix: string[][];
      winningLines: Array<{
        lineIndex: number;
        symbol: string;
        count: number;
        multiplier: number;
        cells: Array<[number, number]>;
      }>;
      lineCount: number;
    };

    let balance = bet.balance;
    let payout = '0';
    if (result.win && result.multiplier > 0) {
      const raw = new D(amount)
        .mul(new D(result.multiplier))
        .toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
      const capped = await capPayout(GAME_TYPE, raw);
      payout = capped.payout.toString();

      if (capped.payout.greaterThan(0)) {
        const credited = await processWin({
          userId,
          betId: bet.transactionId,
          payoutAmount: payout,
          currency,
        });
        balance = credited.balance;
      }
    }

    const session = await prisma.gameSession.create({
      data: {
        userId,
        gameType: GAME_TYPE,
        betAmount: new D(amount),
        payout: new D(payout),
        multiplier: result.multiplier,
        serverSeed: seed.serverSeed,
        clientSeed: seed.clientSeed,
        nonce: seed.nonce,
        resultData: resultData as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    pushBalanceToUser(userId, balance);

    const winningLines = resultData.winningLines.map((line) => ({
      lineIndex: line.lineIndex,
      symbol: line.symbol,
      count: line.count,
      cells: line.cells,
      payout: new D(amount)
        .mul(new D(line.multiplier))
        .toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN)
        .toString(),
    }));

    return {
      sessionId: session.id,
      reelMatrix: resultData.reelMatrix,
      winningLines,
      totalWin: payout,
      newBalance: balance,
      betAmount: amount,
      multiplier: result.multiplier,
      hashedServerSeed: seed.hashedServerSeed,
      clientSeed: seed.clientSeed,
      nonce: seed.nonce,
    };
  });
}
