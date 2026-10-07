import type { FastifyInstance } from 'fastify';

import { prisma } from '../config/prisma';

export function registerHealthRoutes(app: FastifyInstance) {
  app.get('/api/health', async (_req, reply) => {
    const startedAt = Date.now();

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      app.log.error({ err }, 'health check: database unreachable');
      return reply.status(503).send({
        status: 'unhealthy',
        database: 'down',
        ts: Date.now(),
      });
    }

    return {
      status: 'ok',
      database: 'up',
      latencyMs: Date.now() - startedAt,
      ts: Date.now(),
    };
  });
}
