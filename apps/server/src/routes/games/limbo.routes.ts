import type { FastifyInstance } from 'fastify';
import { LIMBO, HOUSE_EDGE } from '../../config/game.config';

export function registerLimboRoutes(app: FastifyInstance) {
  app.get('/api/games/limbo/config', async () => ({
    minMultiplier: LIMBO.minMultiplier,
    maxMultiplier: LIMBO.maxMultiplier,
    houseEdge: HOUSE_EDGE.LIMBO,
  }));
}
