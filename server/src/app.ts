import type { IncomingMessage, ServerResponse } from 'node:http';

import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Application, type Request, type Response } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { database, redis } from './config';
import { env } from './config/env';
import { logger } from './config/logger';
import type { DependencyProbes } from './controllers/health.controller';
import { csrfProtection } from './middleware/csrf';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFound';
import { requestId } from './middleware/requestId';
import { createV1Router } from './routes';
import { createAuthModule, type AuthModule } from './services/auth.module';
import { createDependencyProbes } from './services/health.service';
import type { ApiSuccess } from './types/api';
import { ApiError } from './utils/ApiError';
import { CSRF_HEADER } from './utils/csrf';

export interface CreateAppOptions {
  /**
   * Dependency probes backing `GET /api/v1/health/ready`. Defaults to the real
   * MongoDB and Redis managers; tests inject fakes.
   */
  probes?: DependencyProbes;
  /**
   * Authentication wiring. Defaults to the real repositories over the real
   * models; tests inject a module backed by fakes so no database is needed.
   */
  auth?: AuthModule;
}

/**
 * Builds the Express application.
 *
 * Deliberately separate from `server.ts` so tests can mount the app in-process
 * without binding a port, connecting to a datastore, or managing process
 * lifecycle. This function is the composition root: everything the app needs is
 * passed in, never imported as a hidden global.
 */
export function createApp(options: CreateAppOptions = {}): Application {
  const probes = options.probes ?? createDependencyProbes({ database, redis });
  const auth = options.auth ?? createAuthModule();
  const app = express();

  // Required for correct client IPs (and therefore rate limiting) behind a proxy.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');

  // Correlation id + request logging come first so that failures raised by any
  // later middleware (CORS, body parsing, ...) are still logged with a request id.
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as Request).requestId,
      // Health probes are high-frequency and near-worthless in aggregated logs.
      autoLogging: { ignore: (req) => req.url === `${env.API_PREFIX}/health` },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      customSuccessMessage: (req, res) =>
        `${req.method ?? 'GET'} ${req.url ?? '/'} -> ${res.statusCode}`,
      serializers: {
        req: (req: IncomingMessage) => ({ method: req.method, url: req.url }),
        res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(
    helmet({
      // The API serves JSON only; the CSP is enforced by the frontend host.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and non-browser callers (curl, health checks) send no Origin.
        if (!origin || env.allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(ApiError.forbidden(`Origin ${origin} is not allowed by CORS policy.`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'x-request-id',
        'x-idempotency-key',
        CSRF_HEADER,
      ],
      exposedHeaders: ['x-request-id', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'retry-after'],
      maxAge: 86_400,
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: env.BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: env.BODY_LIMIT }));
  app.use(cookieParser());

  // After `cookieParser` (it reads the cookies) and before the routes, so every
  // cookie-authenticated mutation is checked whether or not the route author
  // remembered to mount it.
  app.use(csrfProtection());

  app.use(env.API_PREFIX, createV1Router({ probes, auth }));

  // Convenience root so `https://api.example.com/` is not a bare 404.
  app.get('/', (req: Request, res: Response) => {
    const body: ApiSuccess<{ health: string; apiPrefix: string }> = {
      success: true,
      message: 'EasyTube API is running',
      data: { health: `${env.API_PREFIX}/health`, apiPrefix: env.API_PREFIX },
      requestId: req.requestId,
    };
    res.status(200).json(body);
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
