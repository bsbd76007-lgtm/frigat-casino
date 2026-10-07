import type { FastifyInstance, FastifyRequest } from 'fastify';
import { hashServerSeed } from '@frigat/shared';
import { prisma } from '../../config/prisma';
import { publicHandle } from './bets.routes';

export function registerBetDetailRoutes(app: FastifyInstance) {
  app.get('/api/bets/:id', async (req: FastifyRequest, reply) => {
    const { id } = req.params as { id: string };

    const bet = await prisma.gameSession.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        gameType: true,
        betAmount: true,
        payout: true,
        multiplier: true,
        serverSeed: true,
        clientSeed: true,
        nonce: true,
        createdAt: true,
      },
    });

    if (!bet) {
      return reply.status(404).send({ error: 'Bet not found' });
    }

    const stillActive = await prisma.provableSeed.findFirst({
      where: { userId: bet.userId, serverSeed: bet.serverSeed, active: true },
      select: { id: true },
    });
    const revealed = !stillActive;

    return {
      id: bet.id,
      userId: bet.userId,
      username: publicHandle(bet.userId),
      gameType: bet.gameType,
      betAmount: bet.betAmount.toString(),
      payout: bet.payout.toString(),
      multiplier: bet.multiplier,
      timestamp: bet.createdAt.getTime(),
      fairness: {
        hashedServerSeed: hashServerSeed(bet.serverSeed),
        serverSeed: revealed ? bet.serverSeed : null,
        revealed,
        clientSeed: bet.clientSeed,
        nonce: bet.nonce,
      },
    };
  });
}
