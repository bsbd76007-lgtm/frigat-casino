/**
 * GET /api/bonuses/me — the deposit-bonus ladder for the signed-in player:
 * which steps are used, what the next deposit earns, and how much is left to
 * wager before a withdrawal unlocks. The bonus itself is credited by the
 * deposit webhook (payment.service); nothing here pays anything out.
 */

import type { FastifyInstance } from 'fastify';

import { identityFromRequest } from '../middleware/auth';
import { getBonusStatus } from '../services/depositBonus.service';
import { MIN_WITHDRAWAL_USD } from '../services/payment.service';

export function registerBonusRoutes(app: FastifyInstance) {
  app.get('/api/bonuses/me', async (req, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });
    return { ...(await getBonusStatus(identity.userId)), minWithdrawal: MIN_WITHDRAWAL_USD };
  });
}
