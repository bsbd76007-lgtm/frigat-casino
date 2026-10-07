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
