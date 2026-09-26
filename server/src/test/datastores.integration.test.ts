import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseManager } from '../config/database';
import { createRedisManager } from '../config/redis';
import { runProbes, sourceProbe } from '../services/health.service';

/**
 * Integration coverage against a real MongoDB + Redis.
 *
 * Skipped by default so `npm test` stays hermetic. Start the datastores and run:
 *
 *   docker compose up -d
 *   npm run test:integration --workspace server
 */
const RUN = process.env.RUN_INTEGRATION_TESTS === 'true';

/**
 * A dedicated database, so this suite never writes into the application one.
 *
 * Every integration suite gets its own variable and its own default. They used to
 * share `MONGODB_TEST_DB`, which is unsafe here: vitest runs files in parallel
 * threads, so one suite's `dropDatabase()` could land while another was still
 * writing, and the failure would look like a flaky driver rather than a test that
 * deleted its neighbour's data.
 */
const TEST_DB = process.env.MONGODB_DATASTORES_TEST_DB ?? 'easytube_datastores_test';
const MONGODB_URI = `${process.env.MONGODB_TEST_BASE ?? 'mongodb://127.0.0.1:27017'}/${TEST_DB}`;

describe.skipIf(!RUN)('datastore integration', () => {
  const database = createDatabaseManager(mongoose, { uri: MONGODB_URI, retryBaseDelayMs: 0 });
  const redis = createRedisManager();

  beforeAll(async () => {
    await database.connect();
    await redis.connect();
  }, 30_000);

  afterAll(async () => {
    await Promise.allSettled([database.disconnect(), redis.disconnect()]);
  });

  describe('mongodb', () => {
    it('reports a live connection', () => {
      expect(database.isReady()).toBe(true);
      expect(database.getStatus()).toBe('connected');
    });

    it('round-trips a document through a real collection', async () => {
      const collection = mongoose.connection.collection('phase2_smoke');

      await collection.insertOne({ ok: true, at: new Date() });
      const found = await collection.findOne({ ok: true });

      expect(found).not.toBeNull();
      await collection.deleteMany({});
    });

    it('rejects a query against a non-existent collection namespace cleanly', async () => {
      const collection = mongoose.connection.collection('phase2_absent');

      await expect(collection.findOne({ _id: new mongoose.Types.ObjectId() })).resolves.toBeNull();
    });
  });

  describe('redis', () => {
    it('reports a live connection', () => {
      expect(redis.isReady()).toBe(true);
      expect(redis.getStatus()).toBe('ready');
    });

    it('answers PING', async () => {
      await expect(redis.client.ping()).resolves.toBe('PONG');
    });
  });

  describe('readiness against live dependencies', () => {
    it('reports both dependencies up', async () => {
      const report = await runProbes({
        database: sourceProbe(database),
        redis: sourceProbe(redis),
      });

      expect(report.ready).toBe(true);
      expect(report.checks.database?.status).toBe('up');
      expect(report.checks.redis?.status).toBe('up');
    });
  });
});
