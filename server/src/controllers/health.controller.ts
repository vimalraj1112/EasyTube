import type { Request, Response } from 'express';

import { env } from '../config/env';
import { runProbes, type DependencyProbe } from '../services/health.service';
import type { HealthData, ReadinessReport } from '../types/api';
import { ApiError } from '../utils/ApiError';
import { sendSuccess } from '../utils/respond';

const startedAt = Date.now();

const uptimeSeconds = (): number => Math.floor((Date.now() - startedAt) / 1_000);

export type DependencyProbes = Readonly<Record<string, DependencyProbe>>;

/**
 * Builds the health controller over an injected set of dependency probes.
 *
 * Injecting the probes is what lets tests exercise both the ready and degraded
 * paths without a live MongoDB or Redis.
 */
export interface HealthController {
  check: (req: Request, res: Response) => void;
  ready: (req: Request, res: Response) => Promise<void>;
}

export function createHealthController(probes: DependencyProbes): HealthController {
  /**
   * Liveness. Deliberately touches no dependency: a restarting database must not
   * cause an orchestrator to kill an otherwise healthy process.
   *
   * GET /api/v1/health
   */
  function check(_req: Request, res: Response): void {
    const data: HealthData = {
      status: 'ok',
      service: env.APP_NAME,
      version: env.APP_VERSION,
      environment: env.NODE_ENV,
      uptimeSeconds: uptimeSeconds(),
      timestamp: new Date().toISOString(),
    };

    sendSuccess(res, { message: 'EasyTube API is running', data });
  }

  /**
   * Readiness. Reports each dependency and answers 503 while any is down, so a
   * load balancer stops routing traffic here.
   *
   * GET /api/v1/health/ready
   */
  async function ready(_req: Request, res: Response): Promise<void> {
    const report: ReadinessReport = await runProbes(probes);

    const data = {
      status: report.ready ? ('ready' as const) : ('degraded' as const),
      checks: report.checks,
      uptimeSeconds: uptimeSeconds(),
      timestamp: new Date().toISOString(),
    };

    if (!report.ready) {
      throw ApiError.serviceUnavailable('EasyTube API is not ready.', data);
    }

    sendSuccess(res, { message: 'EasyTube API is ready', data });
  }

  return { check, ready };
}
