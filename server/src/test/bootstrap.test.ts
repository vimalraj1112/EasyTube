import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import {
  configureServerTimeouts,
  initializeDependencies,
  shutdownAll,
  type ConnectionManagers,
} from '../bootstrap';

const okManager = (): ConnectionManagers[keyof ConnectionManagers] => ({
  connect: vi.fn(() => Promise.resolve()),
  disconnect: vi.fn(() => Promise.resolve()),
});

const failingManager = (message: string): ConnectionManagers[keyof ConnectionManagers] => ({
  connect: vi.fn(() => Promise.reject(new Error(message))),
  disconnect: vi.fn(() => Promise.resolve()),
});

describe('configureServerTimeouts', () => {
  it('sets slow-loris guards with headersTimeout above keepAliveTimeout', () => {
    const server = createServer();

    configureServerTimeouts(server);

    expect(server.keepAliveTimeout).toBe(65_000);
    expect(server.headersTimeout).toBe(66_000);
    expect(server.requestTimeout).toBe(30_000);
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
  });
});

describe('initializeDependencies', () => {
  it('reports every dependency as connected when all succeed', async () => {
    const managers: ConnectionManagers = { database: okManager(), redis: okManager() };

    const report = await initializeDependencies(managers);

    expect(report).toEqual({ database: { ok: true }, redis: { ok: true } });
  });

  it('records the failure reason without throwing when not required on boot', async () => {
    // The test env sets REQUIRE_DATABASES_ON_BOOT=false so `npm run dev` works
    // before Docker is up.
    const managers: ConnectionManagers = {
      database: failingManager('mongo down'),
      redis: okManager(),
    };

    const report = await initializeDependencies(managers);

    expect(report.database.ok).toBe(false);
    expect(report.database.error).toBe('mongo down');
    expect(report.redis.ok).toBe(true);
  });

  it('aborts boot on the first hard failure when required', async () => {
    const { env } = await import('../config/env');
    const original = env.REQUIRE_DATABASES_ON_BOOT;
    (env as { REQUIRE_DATABASES_ON_BOOT: boolean }).REQUIRE_DATABASES_ON_BOOT = true;

    try {
      const managers: ConnectionManagers = {
        database: failingManager('mongo down'),
        redis: okManager(),
      };

      await expect(initializeDependencies(managers)).rejects.toThrow(
        'Failed to connect to database: mongo down',
      );
      // The second manager is never attempted once boot has failed.
      expect(managers.redis.connect).not.toHaveBeenCalled();
    } finally {
      (env as { REQUIRE_DATABASES_ON_BOOT: boolean }).REQUIRE_DATABASES_ON_BOOT = original;
    }
  });
});

describe('shutdownAll', () => {
  function listen(): Promise<Server> {
    const server = createServer((_req, res) => {
      res.end('ok');
    });
    return new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(server));
    });
  }

  it('drains HTTP before releasing dependencies', async () => {
    const server = await listen();
    const order: string[] = [];

    const database = {
      connect: vi.fn(() => Promise.resolve()),
      disconnect: vi.fn(() => {
        order.push('database');
        return Promise.resolve();
      }),
    };
    const redis = {
      connect: vi.fn(() => Promise.resolve()),
      disconnect: vi.fn(() => {
        order.push('redis');
        return Promise.resolve();
      }),
    };

    server.on('close', () => order.push('http'));

    await shutdownAll({ server, database, redis }, 'test');

    expect(order).toEqual(['http', 'database', 'redis']);
    expect(server.listening).toBe(false);
  });

  it('stops new connections once shutdown starts', async () => {
    const server = await listen();
    const { port } = server.address() as AddressInfo;

    await shutdownAll({ server, database: okManager(), redis: okManager() }, 'test');

    await expect(request(`http://127.0.0.1:${port}`).get('/')).rejects.toThrow();
  });

  it('still closes remaining dependencies when one fails', async () => {
    const server = await listen();
    const redis = okManager();

    await shutdownAll(
      {
        server,
        database: {
          connect: vi.fn(() => Promise.resolve()),
          disconnect: vi.fn(() => Promise.reject(new Error('mongo wedged'))),
        },
        redis,
      },
      'test',
    );

    expect(redis.disconnect).toHaveBeenCalledOnce();
  });

  it('works with no HTTP server (dependency-only teardown)', async () => {
    const database = okManager();
    const redis = okManager();

    await shutdownAll({ server: null, database, redis }, 'test');

    expect(database.disconnect).toHaveBeenCalledOnce();
    expect(redis.disconnect).toHaveBeenCalledOnce();
  });
});
