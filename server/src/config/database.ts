import mongoose from 'mongoose';

import { env } from './env';
import { logger } from './logger';

/** `mongoose.Connection.readyState` values, named for readability. */
export const MONGO_READY_STATES = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
  99: 'uninitialized',
} as const;

export type DatabaseStatus = (typeof MONGO_READY_STATES)[keyof typeof MONGO_READY_STATES];

/**
 * The narrow slice of the Mongoose surface this manager needs. Depending on a
 * structural interface (rather than `typeof mongoose`) is what lets the
 * lifecycle be unit-tested without a running mongod.
 */
export interface MongooseLike {
  connect(uri: string, options?: mongoose.ConnectOptions): Promise<unknown>;
  disconnect(): Promise<void>;
  connection: {
    readyState: number;
    on(event: string, listener: (...args: unknown[]) => void): unknown;
  };
  set(key: string, value: unknown): unknown;
}

export interface DatabaseManager {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): DatabaseStatus;
  isReady(): boolean;
  describe(): string;
}

export interface DatabaseManagerOptions {
  /** Override the connection URI. Defaults to `env.MONGODB_URI`. */
  uri?: string;
  /** Retry count after the first attempt. Defaults to `env.MONGO_CONNECT_RETRIES`. */
  retryAttempts?: number;
  /** Base backoff in ms. Defaults to `env.MONGO_RETRY_BASE_DELAY_MS`; use `0` in tests. */
  retryBaseDelayMs?: number;
}

/**
 * Whether Mongoose may build indexes on its own when a model is compiled.
 *
 * In development, yes: a fresh `npm run dev` just works. In production, no:
 * an index build on a large collection competes with live traffic, and the
 * schema changes that need an index should be an explicit, reviewable step. That
 * is `syncModelIndexes()`' job, called once at boot.
 *
 * This lives next to the connect call that uses it so there is a single source
 * of truth; a second copy in the model layer is exactly how the two drift apart.
 */
export function shouldAutoIndex(): boolean {
  return !env.isProduction;
}

const RETRYABLE_CODES = new Set([
  'MongoServerSelectionError',
  'MongoNetworkError',
  'MongoTimeoutError',
  'MongoNotConnectedError',
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRetryable(error: unknown): boolean {
  if (error instanceof Error && RETRYABLE_CODES.has(error.name)) {
    return true;
  }
  // Mongoose surfaces a wrapped aggregate error when every server in the
  // selection times out.
  return (
    error instanceof Error && /buffering timed out|ECONNREFUSED|ETIMEDOUT/i.test(error.message)
  );
}

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Creates a MongoDB lifecycle manager.
 *
 * Connection is *lazy* on purpose: unit tests (and the `npm run dev` loop
 * before Docker is up) never touch the network, while production boot
 * explicitly awaits `connect()`.
 */
export function createDatabaseManager(
  client: MongooseLike = mongoose,
  options: DatabaseManagerOptions = {},
): DatabaseManager {
  // Fail fast instead of buffering queries forever when the driver is down.
  client.set('bufferCommands', false);
  client.set('strictQuery', true);

  const retryBaseDelayMs = options.retryBaseDelayMs ?? env.MONGO_RETRY_BASE_DELAY_MS;
  const uri = options.uri ?? env.MONGODB_URI;

  client.connection.on('error', (error: unknown) => {
    logger.error({ err: error }, 'MongoDB connection error');
  });
  client.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });
  client.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected');
  });

  const getStatus = (): DatabaseStatus =>
    MONGO_READY_STATES[client.connection.readyState as keyof typeof MONGO_READY_STATES] ??
    'uninitialized';

  const connect = async (): Promise<void> => {
    if (client.connection.readyState === 1) {
      logger.debug('MongoDB already connected, skipping');
      return;
    }

    const attempts = (options.retryAttempts ?? env.MONGO_CONNECT_RETRIES) + 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await client.connect(uri, {
          maxPoolSize: env.MONGO_MAX_POOL_SIZE,
          minPoolSize: env.MONGO_MIN_POOL_SIZE,
          serverSelectionTimeoutMS: env.MONGO_SERVER_SELECTION_TIMEOUT_MS,
          socketTimeoutMS: env.MONGO_SOCKET_TIMEOUT_MS,
          autoIndex: shouldAutoIndex(),
        });

        logger.info({ host: redactMongoUri(uri) }, 'MongoDB connection established');
        return;
      } catch (error) {
        lastError = error;

        if (attempt === attempts || !isRetryable(error)) {
          break;
        }

        const delay = retryBaseDelayMs * attempt;
        logger.warn(
          { attempt, attempts, delayMs: delay, reason: errorMessage(error) },
          'MongoDB connection failed, retrying',
        );
        await sleep(delay);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`MongoDB connection failed: ${errorMessage(lastError)}`);
  };

  const disconnect = async (): Promise<void> => {
    if (client.connection.readyState === 0) {
      return;
    }
    await client.disconnect();
    logger.info('MongoDB connection closed');
  };

  return {
    connect,
    disconnect,
    getStatus,
    isReady: () => client.connection.readyState === 1,
    describe: () => `mongodb ${getStatus()}`,
  };
}

/** Strips credentials so a URI can safely appear in logs. */
export function redactMongoUri(uri: string): string {
  return uri.replace(/\/\/([^@/]+)@/, '//***:***@');
}

/** Process-wide singleton used by the app and the readiness probe. */
export const database: DatabaseManager = createDatabaseManager();
