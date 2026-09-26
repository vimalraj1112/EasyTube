import { describe, expect, it, vi } from 'vitest';

import { createDatabaseManager, redactMongoUri, type MongooseLike } from '../config/database';

interface FakeOptions {
  readyState?: number;
  failTimes?: number;
  errorName?: string;
  errorMessage?: string;
}

interface FakeMongoose {
  client: MongooseLike;
  state: {
    readyState: number;
    connectCalls: number;
    disconnectCalls: number;
    setCalls: number;
    settings: Record<string, unknown>;
  };
  listeners: Record<string, Array<(...args: unknown[]) => void>>;
}

function createFakeMongoose(options: FakeOptions = {}): FakeMongoose {
  const state = {
    readyState: options.readyState ?? 0,
    connectCalls: 0,
    disconnectCalls: 0,
    setCalls: 0,
    settings: {} as Record<string, unknown>,
  };

  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

  const client: MongooseLike = {
    connect: vi.fn(() => {
      state.connectCalls += 1;

      if (state.connectCalls <= (options.failTimes ?? 0)) {
        const error = new Error(options.errorMessage ?? 'connection refused');
        error.name = options.errorName ?? 'MongoServerSelectionError';
        return Promise.reject(error);
      }

      state.readyState = 1;
      return Promise.resolve(client);
    }),
    disconnect: vi.fn(() => {
      state.disconnectCalls += 1;
      state.readyState = 0;
      return Promise.resolve();
    }),
    connection: {
      get readyState() {
        return state.readyState;
      },
      on(event: string, listener: (...args: unknown[]) => void) {
        (listeners[event] ??= []).push(listener);
        return client.connection;
      },
    },
    set: vi.fn((key: string, value: unknown) => {
      state.setCalls += 1;
      state.settings[key] = value;
      return client;
    }),
  };

  return { client, state, listeners };
}

/** Zero backoff so retry tests do not sleep on the real production delay. */
const fastRetries = { retryBaseDelayMs: 0 } as const;

describe('createDatabaseManager', () => {
  it('applies safe driver settings at construction', () => {
    const { client, state } = createFakeMongoose();

    createDatabaseManager(client);

    expect(state.settings).toEqual({ bufferCommands: false, strictQuery: true });
    expect(state.setCalls).toBe(2);
  });

  it('reports the initial status before any connection attempt', () => {
    const { client } = createFakeMongoose({ readyState: 0 });
    const manager = createDatabaseManager(client);

    expect(manager.getStatus()).toBe('disconnected');
    expect(manager.isReady()).toBe(false);
    expect(manager.describe()).toBe('mongodb disconnected');
  });

  it('maps every mongoose readyState to a named status', () => {
    const cases: Array<[number, string]> = [
      [0, 'disconnected'],
      [1, 'connected'],
      [2, 'connecting'],
      [3, 'disconnecting'],
      [99, 'uninitialized'],
    ];

    for (const [readyState, expected] of cases) {
      const { client } = createFakeMongoose({ readyState });
      expect(createDatabaseManager(client).getStatus()).toBe(expected);
    }
  });

  it('reports connected once connect resolves', async () => {
    const { client } = createFakeMongoose();
    const manager = createDatabaseManager(client);

    await manager.connect();

    expect(manager.isReady()).toBe(true);
    expect(manager.getStatus()).toBe('connected');
    expect(manager.describe()).toBe('mongodb connected');
  });

  it('skips a redundant connect when already connected', async () => {
    const { client, state } = createFakeMongoose();
    const manager = createDatabaseManager(client);

    await manager.connect();
    await manager.connect();

    expect(state.connectCalls).toBe(1);
  });

  it('retries a retryable failure and eventually succeeds', async () => {
    const { client, state } = createFakeMongoose({ failTimes: 2 });
    const manager = createDatabaseManager(client, fastRetries);

    await manager.connect();

    expect(state.connectCalls).toBe(3);
    expect(manager.isReady()).toBe(true);
  });

  it('retries a network-level ECONNREFUSED failure', async () => {
    const { client, state } = createFakeMongoose({
      failTimes: 1,
      errorName: 'Error',
      errorMessage: 'connect ECONNREFUSED 127.0.0.1:27017',
    });
    const manager = createDatabaseManager(client, fastRetries);

    await manager.connect();

    expect(state.connectCalls).toBe(2);
  });

  it('gives up immediately on a non-retryable failure', async () => {
    const { client, state } = createFakeMongoose({
      failTimes: 99,
      errorName: 'MongoParseError',
      errorMessage: 'bad uri',
    });
    const manager = createDatabaseManager(client, fastRetries);

    await expect(manager.connect()).rejects.toThrow('bad uri');
    expect(state.connectCalls).toBe(1);
  });

  it('honours an explicit retry-attempt override', async () => {
    const { client, state } = createFakeMongoose({
      failTimes: 99,
      errorName: 'MongoServerSelectionError',
    });
    const manager = createDatabaseManager(client, { retryAttempts: 2, retryBaseDelayMs: 0 });

    await expect(manager.connect()).rejects.toThrow();
    expect(state.connectCalls).toBe(3);
  });

  it('backs off linearly with the attempt number', async () => {
    const { client } = createFakeMongoose({ failTimes: 2 });
    const manager = createDatabaseManager(client, { retryBaseDelayMs: 10 });

    const startedAt = Date.now();
    await manager.connect();

    // attempt 1 -> 10ms, attempt 2 -> 20ms
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(25);
  });

  it('is a no-op to disconnect when never connected', async () => {
    const { client, state } = createFakeMongoose();
    const manager = createDatabaseManager(client);

    await manager.disconnect();

    expect(state.disconnectCalls).toBe(0);
  });

  it('closes an open connection', async () => {
    const { client, state } = createFakeMongoose();
    const manager = createDatabaseManager(client);

    await manager.connect();
    await manager.disconnect();

    expect(state.disconnectCalls).toBe(1);
    expect(manager.isReady()).toBe(false);
  });

  it('subscribes to connection lifecycle events', () => {
    const { client, listeners } = createFakeMongoose();

    createDatabaseManager(client);

    expect(Object.keys(listeners).sort()).toEqual(['disconnected', 'error', 'reconnected']);
  });
});

describe('redactMongoUri', () => {
  it('strips credentials so a URI is safe to log', () => {
    expect(redactMongoUri('mongodb+srv://user:secret@cluster0.abc.mongodb.net/easytube')).toBe(
      'mongodb+srv://***:***@cluster0.abc.mongodb.net/easytube',
    );
  });

  it('leaves a credential-free URI untouched', () => {
    expect(redactMongoUri('mongodb://127.0.0.1:27017/easytube')).toBe(
      'mongodb://127.0.0.1:27017/easytube',
    );
  });
});
