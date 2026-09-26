import { createServer, type Server } from 'node:http';

import { createApp } from './app';
import { database, redis } from './config';
import { env } from './config/env';
import { logger } from './config/logger';
import type { DatabaseManager } from './config/database';
import type { RedisManager } from './config/redis';
import { syncModelIndexes, type ModelName } from './models';

export interface DependencyReport {
  database: { ok: boolean; error?: string };
  redis: { ok: boolean; error?: string };
}

export interface ConnectionManagers {
  database: Pick<DatabaseManager, 'connect' | 'disconnect'>;
  redis: Pick<RedisManager, 'connect' | 'disconnect'>;
}

export interface ShutdownTargets extends ConnectionManagers {
  server: Server | null;
}

export interface AppRuntime {
  server: Server;
  /** Idempotent, ordered teardown of the HTTP server and every dependency. */
  shutdown: (reason: string) => Promise<void>;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Connects external dependencies before the server accepts traffic.
 *
 * When `REQUIRE_DATABASES_ON_BOOT` is false a failure is logged and swallowed so
 * the process still boots and simply reports itself not-ready - useful during
 * local development before Docker is up. In production the env schema forces
 * the flag to true, so a missing datastore is a hard boot failure.
 */
export async function initializeDependencies(
  managers: ConnectionManagers = { database, redis },
): Promise<DependencyReport> {
  const results: DependencyReport = {
    database: { ok: false },
    redis: { ok: false },
  };

  for (const [name, manager] of [
    ['database', managers.database],
    ['redis', managers.redis],
  ] as const) {
    try {
      await manager.connect();
      results[name] = { ok: true };
    } catch (error) {
      const reason = errorMessage(error);
      results[name] = { ok: false, error: reason };

      if (env.REQUIRE_DATABASES_ON_BOOT) {
        logger.error({ dependency: name, reason }, 'Dependency connection failed, aborting boot');
        throw new Error(`Failed to connect to ${name}: ${reason}`, { cause: error });
      }

      logger.warn(
        { dependency: name, reason },
        'Dependency unavailable at boot, API will report itself not-ready',
      );
    }
  }

  return results;
}

/**
 * Slow-loris and connection-exhaustion guards.
 * `headersTimeout` must exceed `keepAliveTimeout` or Node warns and drops
 * connections during the keep-alive window.
 */
export function configureServerTimeouts(server: Server): void {
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 30_000;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(env.PORT, env.HOST, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

/** Stops accepting connections and waits for in-flight requests to finish. */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

/**
 * Ordered teardown: drain HTTP first so no new work arrives, then release the
 * datastore connections. The whole sequence is bounded by
 * `SHUTDOWN_TIMEOUT_MS` so a deploy can never hang on a stuck socket, and a
 * single failing dependency never prevents the others from closing.
 */
export async function shutdownAll(targets: ShutdownTargets, reason: string): Promise<void> {
  const { server } = targets;

  const steps: Array<{ name: string; run: () => Promise<unknown> }> = [
    ...(server ? [{ name: 'http', run: () => closeServer(server) }] : []),
    { name: 'database', run: () => targets.database.disconnect() },
    { name: 'redis', run: () => targets.redis.disconnect() },
  ];

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Graceful shutdown exceeded ${env.SHUTDOWN_TIMEOUT_MS}ms`)),
      env.SHUTDOWN_TIMEOUT_MS,
    );
    timer.unref();
  });

  const drain = (async () => {
    for (const step of steps) {
      try {
        await step.run();
        logger.debug({ step: step.name }, 'Shutdown step complete');
      } catch (error) {
        logger.error({ step: step.name, err: errorMessage(error) }, 'Shutdown step failed');
      }
    }
  })();

  try {
    await Promise.race([drain, deadline]);
    logger.info({ reason }, 'Graceful shutdown complete');
  } catch (error) {
    logger.error({ reason, err: errorMessage(error) }, 'Graceful shutdown timed out');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Creates the declared indexes once, explicitly.
 *
 * `autoIndex` is disabled in production, so without this a fresh deploy would
 * serve traffic against unindexed collections - slow queries, and no unique
 * enforcement, which would quietly break email and idempotency guarantees.
 * Indexes are only created, never dropped: a drop has to be a deliberate
 * migration.
 */
export async function initializeModelIndexes(
  sync: () => Promise<Record<ModelName, string[]>> = () => syncModelIndexes(),
): Promise<void> {
  try {
    const result = await sync();
    logger.info({ models: Object.keys(result) }, 'Database indexes ready');
  } catch (error) {
    // A missing index degrades performance; a missing unique index is a
    // correctness problem. Neither is a reason to refuse to boot, but it has
    // to be loud.
    logger.error({ err: errorMessage(error) }, 'Failed to synchronise model indexes');
  }
}

/**
 * Full process startup: dependencies, then HTTP.
 * Returns a runtime handle so the caller controls signals and exit codes.
 */
export async function bootstrap(): Promise<AppRuntime> {
  await initializeDependencies();
  await initializeModelIndexes();

  const app = createApp();
  const server = createServer(app);
  configureServerTimeouts(server);

  await listen(server);

  let stopped = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await shutdownAll({ server, database, redis }, reason);
  };

  logger.info(
    {
      port: env.PORT,
      host: env.HOST,
      env: env.NODE_ENV,
      health: `${env.API_PREFIX}/health`,
      readiness: `${env.API_PREFIX}/health/ready`,
      allowedOrigins: env.allowedOrigins,
      requireDatabasesOnBoot: env.REQUIRE_DATABASES_ON_BOOT,
    },
    `${env.APP_NAME} v${env.APP_VERSION} listening on http://${env.HOST}:${env.PORT}${env.API_PREFIX}`,
  );

  return { server, shutdown };
}
