/**
 * FRIGAT — VIP & daily bonus routes
 *
 *   GET  /api/vip/me              tier, wagered volume, claimable rakeback
 *   POST /api/vip/claim-rakeback  credit the claimable amount
 *
 * The daily wheel (/api/bonus/spin, /api/vip/daily-wheel) was removed with the
 * Free Money page — no free spins are paid out any more.
 *
 * All reward maths lives in bonus.service; these handlers only translate
 * between HTTP and that service, so the eligibility and idempotency guards
 * cannot be bypassed by calling a different endpoint.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { identityFromRequest } from '../middleware/auth';
import { pushBalanceToUser } from '../websocket/socket.server';
import { WalletNotFoundError } from '../services/ledger.service';
import {
  claimRakeback,
  getVipStatus,
  NothingToClaimError,
  VIP_TIERS,
} from '../services/bonus.service';

export function registerVipRoutes(app: FastifyInstance) {
  app.get('/api/vip/config', async () => ({ tiers: VIP_TIERS }));

  app.get('/api/vip/me', async (req, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });

    const currency = (req.query as { currency?: string }).currency;
    return getVipStatus({ userId: identity.userId, currency });
  });

  app.post('/api/vip/claim-rakeback', async (req, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });

    const currency = (req.body as { currency?: string })?.currency;

    try {
      const result = await claimRakeback({ userId: identity.userId, currency });
      pushBalanceToUser(identity.userId, result.balance);
      return result;
    } catch (err) {
      if (err instanceof NothingToClaimError) {
        return reply.code(409).send({ error: 'nothing_to_claim' });
      }
      if (err instanceof WalletNotFoundError) {
        return reply.code(404).send({ error: 'wallet_not_found' });
      }
      throw err;
    }
  });
}
