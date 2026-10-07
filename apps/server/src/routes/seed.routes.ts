import type { FastifyInstance } from 'fastify';
import { identityFromRequest } from '../middleware/auth';
import {
  getActiveSeed,
  setClientSeed,
  rotateSeed,
  InvalidClientSeedError,
  SeedInUseError,
} from '../services/provableFair.service';

export function registerSeedRoutes(app: FastifyInstance) {
  app.get('/api/seeds/active', async (req, reply) => {
    const identity = identityFromRequest(req);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });

    const seed = await getActiveSeed(identity.userId);
    return {
      clientSeed: seed.clientSeed,
      hashedServerSeed: seed.hashedServerSeed,
      nonce: seed.nonce,
    };
  });

  app.post<{ Body: { clientSeed?: string } }>(
    '/api/seeds/rotate',
    async (req, reply) => {
      const identity = identityFromRequest(req);
      if (!identity) return reply.code(401).send({ error: 'unauthorized' });

      const requested = req.body?.clientSeed;

      try {
        const { active, revealed } =
          typeof requested === 'string'
            ? await setClientSeed(identity.userId, requested)
            : await rotateSeed(identity.userId);

        return {
          clientSeed: active.clientSeed,
          hashedServerSeed: active.hashedServerSeed,
          nonce: active.nonce,
          serverSeed: revealed?.serverSeed ?? null,
          previousHashedServerSeed: revealed?.hashedServerSeed ?? null,
          previousClientSeed: revealed?.clientSeed ?? null,
          previousNonce: revealed?.nonce ?? null,
        };
      } catch (err) {
        if (err instanceof InvalidClientSeedError) {
          return reply.code(400).send({ error: 'invalid_client_seed', message: err.message });
        }
        if (err instanceof SeedInUseError) {
          return reply.code(409).send({ error: 'seed_in_use', message: err.message });
        }
        throw err;
      }
    }
  );
}
