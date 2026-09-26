import { Router } from 'express';

import type { DependencyProbes } from '../controllers/health.controller';
import type { AuthModule } from '../services/auth.module';
import { createAuthRoutes } from './auth.routes';
import { createHealthRoutes } from './health.routes';

/**
 * API v1 surface. Each domain router owns its full sub-paths (`/auth/login`,
 * `/media/analyze`, ...) and is mounted at the v1 root, so this file stays a
 * single readable table of everything the API exposes.
 *
 * Built as a factory so dependency wiring (probes today, queues in Phase 7,
 * services from Phase 3 onward) is explicit at the composition root.
 */
export interface V1RouterDeps {
  probes: DependencyProbes;
  auth: AuthModule;
}

export function createV1Router({ probes, auth }: V1RouterDeps): Router {
  const router = Router();

  // Auth first: it owns `/auth/*` and the CSRF-protected POST surface.
  router.use(createAuthRoutes({ service: auth.service, users: auth.users }));
  router.use(createHealthRoutes(probes));

  return router;
}
