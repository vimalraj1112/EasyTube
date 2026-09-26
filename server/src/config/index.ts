/**
 * Single import point for configuration concerns.
 *
 * Feature code should `import { env, logger } from '../config'` rather than
 * reaching into individual files, so the configuration surface stays explicit.
 */

export { env, DEV_ACCESS_SECRET, DEV_REFRESH_SECRET } from './env';
export { logger, createLogger, type Logger } from './logger';
export * from './constants';
export {
  database,
  createDatabaseManager,
  redactMongoUri,
  MONGO_READY_STATES,
  type DatabaseManager,
  type DatabaseStatus,
  type MongooseLike,
} from './database';
export {
  redis,
  createRedisManager,
  redactRedisUrl,
  REDIS_STATUSES,
  type RedisClientFactory,
  type RedisLike,
  type RedisManager,
  type RedisStatus,
} from './redis';
