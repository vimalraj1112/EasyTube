import { Router } from 'express';

import { createHealthController, type DependencyProbes } from '../controllers/health.controller';
import { asyncHandler } from '../utils/asyncHandler';

export function createHealthRoutes(probes: DependencyProbes): Router {
  const router = Router();
  const controller = createHealthController(probes);

  /** Liveness - the process is up. */
  router.get('/health', controller.check);

  /** Readiness - dependencies are usable. Answers 503 while degraded. */
  router.get('/health/ready', asyncHandler(controller.ready));

  return router;
}
