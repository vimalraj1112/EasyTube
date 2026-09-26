import type { DependencyCheck, ReadinessReport } from '../types/api';

/**
 * A dependency that can report whether it is usable right now.
 * Both the database and Redis managers satisfy this.
 */
export interface ReadinessSource {
  isReady(): boolean;
  describe(): string;
}

export type DependencyProbe = () => DependencyCheck | Promise<DependencyCheck>;

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

async function runProbe(probe: DependencyProbe): Promise<DependencyCheck> {
  const startedAt = process.hrtime.bigint();

  try {
    const result = await probe();
    return { ...result, latencyMs: roundMs(elapsedMs(startedAt)) };
  } catch (error) {
    // A probe must never throw: a broken dependency is a "down" result, not a
    // failed readiness request.
    return {
      status: 'down',
      latencyMs: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Runs every probe concurrently and aggregates the outcome.
 *
 * Probes read local connection state rather than issuing round trips, so
 * readiness stays fast enough for a load balancer to poll it.
 */
export async function runProbes(
  probes: Readonly<Record<string, DependencyProbe>>,
): Promise<ReadinessReport> {
  const entries = await Promise.all(
    Object.entries(probes).map(
      async ([name, probe]): Promise<readonly [string, DependencyCheck]> => [
        name,
        await runProbe(probe),
      ],
    ),
  );

  const checks = Object.fromEntries(entries) as Record<string, DependencyCheck>;

  return {
    ready: Object.values(checks).every((check) => check.status === 'up'),
    checks,
  };
}

/** Builds a state-reading probe from a `ReadinessSource`. */
export function sourceProbe(source: ReadinessSource): DependencyProbe {
  return () => ({
    status: source.isReady() ? 'up' : 'down',
    latencyMs: null,
    detail: source.describe(),
  });
}

/** The probes used by the running application. */
export function createDependencyProbes(sources: {
  database: ReadinessSource;
  redis: ReadinessSource;
}): Record<string, DependencyProbe> {
  return {
    database: sourceProbe(sources.database),
    redis: sourceProbe(sources.redis),
  };
}
