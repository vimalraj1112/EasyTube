import { describe, expect, it, vi } from 'vitest';

import {
  createRedisManager,
  redactRedisUrl,
  type RedisClientFactory,
  type RedisLike,
} from '../config/redis';

interface FakeOptions {
  status?: string;
  failConnect?: boolean;
  failQuit?: boolean;
}

interface FakeRedis {
  client: RedisLike;
  factory: RedisClientFactory;
  state: { status: string; connectCalls: number; quitCalls: number; disconnectCalls: number };
  listeners: Record<string, Array<(...args: unknown[]) => void>>;
}

function createFakeRedis(options: FakeOptions = {}): FakeRedis {
  const state = {
    status: options.status ?? 'wait',
    connectCalls: 0,
    quitCalls: 0,
    disconnectCalls: 0,
  };

  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

  const client: RedisLike = {
    get status() {
      return state.status;
    },
    connect: vi.fn(() => {
      state.connectCalls += 1;
      if (options.failConnect) {
        return Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:6379'));
      }
      state.status = 'ready';
      return Promise.resolve('OK');
    }),
    quit: vi.fn(() => {
      state.quitCalls += 1;
      if (options.failQuit) {
        return Promise.reject(new Error('Connection is closed.'));
      }
      state.status = 'end';
      return Promise.resolve('OK');
    }),
    disconnect: vi.fn(() => {
      state.disconnectCalls += 1;
      state.status = 'end';
    }),
    ping: vi.fn(() => Promise.resolve('PONG')),
    on(event: string, listener: (...args: unknown[]) => void) {
      (listeners[event] ??= []).push(listener);
      return client;
    },
  };

  const factory: RedisClientFactory = vi.fn(() => client);

  return { client, factory, state, listeners };
}

describe('createRedisManager', () => {
  it('starts disconnected and not ready (lazyConnect)', () => {
    const { factory } = createFakeRedis();
    const manager = createRedisManager(factory);

    expect(manager.getStatus()).toBe('wait');
    expect(manager.isReady()).toBe(false);
    expect(manager.describe()).toBe('redis wait');
  });

  it('exposes the underlying client for queues and rate limiting', () => {
    const { client, factory } = createFakeRedis();
    const manager = createRedisManager(factory);

    expect(manager.client).toBe(client);
  });

  it('reports ready after a successful connect', async () => {
    const { factory, state } = createFakeRedis();
    const manager = createRedisManager(factory);

    await manager.connect();

    expect(state.connectCalls).toBe(1);
    expect(manager.isReady()).toBe(true);
    expect(manager.getStatus()).toBe('ready');
  });

  it('skips a redundant connect when already ready', async () => {
    const { factory, state } = createFakeRedis();
    const manager = createRedisManager(factory);

    await manager.connect();
    await manager.connect();

    expect(state.connectCalls).toBe(1);
  });

  it('propagates a connect failure to the boot policy', async () => {
    const { factory } = createFakeRedis({ failConnect: true });
    const manager = createRedisManager(factory);

    await expect(manager.connect()).rejects.toThrow('ECONNREFUSED');
    expect(manager.isReady()).toBe(false);
  });

  it('quits cleanly on disconnect', async () => {
    const { factory, state } = createFakeRedis();
    const manager = createRedisManager(factory);

    await manager.connect();
    await manager.disconnect();

    expect(state.quitCalls).toBe(1);
    expect(state.disconnectCalls).toBe(0);
  });

  it('hard-closes when quit fails so shutdown always completes', async () => {
    const { factory, state } = createFakeRedis({ failQuit: true });
    const manager = createRedisManager(factory);

    await manager.connect();
    await expect(manager.disconnect()).resolves.toBeUndefined();

    expect(state.disconnectCalls).toBe(1);
  });

  it('is a no-op to disconnect when the client already ended', async () => {
    const { factory, state } = createFakeRedis({ status: 'end' });
    const manager = createRedisManager(factory);

    await manager.disconnect();

    expect(state.quitCalls).toBe(0);
    expect(state.disconnectCalls).toBe(0);
  });

  it('only treats "ready" as usable', () => {
    for (const status of ['connecting', 'reconnecting', 'close', 'end', 'wait']) {
      const { factory } = createFakeRedis({ status });
      expect(createRedisManager(factory).isReady()).toBe(false);
    }
  });

  it('falls back to "close" for an unrecognised status', () => {
    const { factory } = createFakeRedis({ status: 'something-else' });

    expect(createRedisManager(factory).getStatus()).toBe('close');
  });

  it('subscribes to error and reconnect events', () => {
    const { factory, listeners } = createFakeRedis();

    createRedisManager(factory);

    expect(Object.keys(listeners).sort()).toEqual(['error', 'ready', 'reconnecting']);
  });

  it('passes a key prefix and timeouts to the client factory', () => {
    const { factory } = createFakeRedis();

    createRedisManager(factory);

    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        lazyConnect: true,
        keyPrefix: 'easytube:',
        connectTimeout: expect.any(Number),
        commandTimeout: expect.any(Number),
      }),
    );
  });
});

describe('redactRedisUrl', () => {
  it('strips credentials so a URL is safe to log', () => {
    expect(redactRedisUrl('redis://default:hunter2@cache.upstash.io:6379')).toBe(
      'redis://***:***@cache.upstash.io:6379',
    );
  });

  it('leaves a credential-free URL untouched', () => {
    expect(redactRedisUrl('redis://127.0.0.1:6379')).toBe('redis://127.0.0.1:6379');
  });
});
