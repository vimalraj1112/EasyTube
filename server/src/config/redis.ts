import { Redis, type RedisOptions } from 'ioredis';

import { env } from './env';
import { logger } from './logger';

export const REDIS_STATUSES = [
  'wait',
  'connecting',
  'connect',
  'ready',
  'reconnecting',
  'close',
  'end',
] as const;

export type RedisStatus = (typeof REDIS_STATUSES)[number];

/** Known ioredis statuses that mean "commands will succeed right now". */
const READY_STATUSES = new Set<RedisStatus>(['ready']);

/**
 * Narrow slice of the ioredis surface used by the app. Structural typing keeps
 * the lifecycle unit-testable without a running Redis.
 */
export interface RedisLike {
  readonly status: string;
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  disconnect(): void;
  ping(): Promise<string>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export type RedisClientFactory = (url: string, options: RedisOptions) => RedisLike;

export interface RedisManager {
  /** The underlying client. Exposed for Phase 7 (BullMQ) and Phase 14 (rate limits). */
  readonly client: RedisLike;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): RedisStatus;
  isReady(): boolean;
  describe(): string;
}

function buildOptions(): RedisOptions {
  return {
    // We drive the connection explicitly during boot instead of letting ioredis
    // open a socket at import time.
    lazyConnect: true,
    connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
    commandTimeout: env.REDIS_COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: env.REDIS_MAX_RETRIES_PER_REQUEST,
    keyPrefix: env.REDIS_KEY_PREFIX,
    // Exponential-ish backoff, capped, so a long outage does not spin the CPU.
    retryStrategy: (attempt: number): number => Math.min(attempt * 200, 3_000),
  };
}

/**
 * Creates a Redis lifecycle manager around a client produced by `factory`.
 *
 * `ioredis` is used (rather than `node-redis`) because BullMQ in Phase 7 is
 * built on it, so the connection settings and key prefix stay consistent.
 */
export function createRedisManager(
  factory: RedisClientFactory = (url, options) => new Redis(url, options),
  url: string = env.REDIS_URL,
): RedisManager {
  const client = factory(url, buildOptions());

  client.on('error', (error: unknown) => {
    logger.error({ err: error instanceof Error ? error.message : error }, 'Redis connection error');
  });
  client.on('reconnecting', (delay: unknown) => {
    logger.warn({ delayMs: delay }, 'Redis reconnecting');
  });
  client.on('ready', () => {
    logger.info({ keyPrefix: env.REDIS_KEY_PREFIX }, 'Redis connection established');
  });

  const getStatus = (): RedisStatus => {
    const status = client.status as RedisStatus;
    return REDIS_STATUSES.includes(status) ? status : 'close';
  };

  const connect = async (): Promise<void> => {
    if (READY_STATUSES.has(getStatus())) {
      logger.debug('Redis already connected, skipping');
      return;
    }

    // `connect()` rejects when the first attempt fails; the retry strategy keeps
    // reconnecting in the background, so surface the failure to the caller and
    // let the boot policy decide what to do.
    await client.connect();
    logger.info({ url: redactRedisUrl(url) }, 'Redis connected');
  };

  const disconnect = async (): Promise<void> => {
    if (getStatus() === 'end') {
      return;
    }

    try {
      await client.quit();
    } catch {
      // A client that never connected throws on quit; hard-close instead so
      // shutdown always completes.
      client.disconnect();
    }
    logger.info('Redis connection closed');
  };

  return {
    client,
    connect,
    disconnect,
    getStatus,
    isReady: () => READY_STATUSES.has(getStatus()),
    describe: () => `redis ${getStatus()}`,
  };
}

/** Strips any `redis://:password@` credentials so a URL can appear in logs. */
export function redactRedisUrl(url: string): string {
  return url.replace(/\/\/([^@/]+)@/, '//***:***@');
}

/** Process-wide singleton used by the app and the readiness probe. */
export const redis: RedisManager = createRedisManager();
