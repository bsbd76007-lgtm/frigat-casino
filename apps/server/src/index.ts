import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';

import { config } from './config';
import { prisma } from './config/prisma';
import { version as SERVER_VERSION } from '../package.json';
import { registerSocketServer } from './websocket/socket.server';
import { registerSessionGuard } from './middleware/auth';
import { registerRoutes } from './routes';

export async function buildApp(options: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: options.logger === false ? false : {
      level: config.env === 'production' ? 'info' : 'debug',
      transport:
        config.env === 'production'
          ? undefined
          : { target: 'pino-pretty', options: { colorize: true } },
    },
  });

  await app.register(cors, {
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (config.webOrigins.includes(origin)) return cb(null, true);

      app.log.warn(
        { origin, allowed: config.webOrigins },
        'CORS: rejected an origin that is not on the allow-list'
      );
      cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86_400,
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Resource-Policy', 'same-site');
    reply.header(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    );
    reply.header('Cache-Control', 'no-store');
    if (config.env === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    return payload;
  });

  await app.register(websocket, {
    options: { maxPayload: 1 << 20 },
  });

  app.get('/', async () => ({
    status: 'ok',
    server: 'Frigat API',
    version: SERVER_VERSION,
  }));

  app.get('/health', async () => ({ status: 'ok', ts: Date.now() }));
  app.get('/ready', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ready' };
  });

  registerSessionGuard(app);

  registerRoutes(app);

  registerSocketServer(app);

  return app;
}

async function bootstrap() {
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received — shutting down`);
    try {
      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
  app.log.info(`Frigat server listening on ${config.host}:${config.port}`);
}

if (require.main === module) {
  bootstrap().catch((err) => {
     
    console.error('Fatal: failed to start server', err);
    process.exit(1);
  });
}
