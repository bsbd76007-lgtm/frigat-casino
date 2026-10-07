import type { FastifyInstance } from 'fastify';
import { registerAdminMetricsRoutes } from './metrics.routes';
import { registerAdminUserRoutes } from './users.routes';
import { registerAdminRiskRoutes } from './risk.routes';

export function registerAdminRoutes(app: FastifyInstance) {
  registerAdminMetricsRoutes(app);
  registerAdminUserRoutes(app);
  registerAdminRiskRoutes(app);
}
