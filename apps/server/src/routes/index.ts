import type { FastifyInstance } from 'fastify';

import { registerHealthRoutes } from './health.routes';
import { registerAuthRoutes } from './auth.routes';
import { registerAccountRoutes } from './account.routes';
import { registerAdminRoutes } from './admin';
import { registerPaymentRoutes } from './payment.routes';
import { registerSupportRoutes } from './support.routes';
import { registerReferralRoutes } from './referral.routes';
import { registerVipRoutes } from './vip.routes';
import { registerBonusRoutes } from './bonuses.routes';
import { registerSeedRoutes } from './seed.routes';
import { registerGameRoutes } from './games';

export function registerRoutes(app: FastifyInstance) {
  registerHealthRoutes(app);

  registerAuthRoutes(app);

  registerAccountRoutes(app);

  registerAdminRoutes(app);

  registerPaymentRoutes(app);

  registerSupportRoutes(app);

  registerReferralRoutes(app);
  registerVipRoutes(app);
  registerBonusRoutes(app);

  registerSeedRoutes(app);

  registerGameRoutes(app);
}
