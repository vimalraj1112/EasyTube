import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { env } from '../config/env';
import type { DependencyProbe } from '../services/health.service';

const app = createApp();

/** Builds a probe set where the named dependencies are up or down. */
function probesFor(state: Record<string, boolean>): Record<string, DependencyProbe> {
  return Object.fromEntries(
    Object.entries(state).map(([name, up]) => [
      name,
      () => ({
        status: up ? ('up' as const) : ('down' as const),
        latencyMs: null,
        detail: `${name} ${up ? 'up' : 'down'}`,
      }),
    ]),
  );
}

describe('GET /api/v1/health (liveness)', () => {
  beforeAll(() => {
    expect(app).toBeDefined();
  });

  it('returns 200 with the documented success envelope', async () => {
    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'EasyTube API is running',
    });
    expect(response.body.data).toMatchObject({
      status: 'ok',
      service: 'easytube-api',
      environment: 'test',
    });
  });

  it('exposes typed health metadata', async () => {
    const response = await request(app).get('/api/v1/health');

    expect(typeof response.body.data.version).toBe('string');
    expect(typeof response.body.data.uptimeSeconds).toBe('number');
    expect(Number.isNaN(Date.parse(response.body.data.timestamp))).toBe(false);
  });

  it('echoes a correlation id on the response', async () => {
    const response = await request(app).get('/api/v1/health');

    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('honours an inbound x-request-id', async () => {
    const response = await request(app).get('/api/v1/health').set('x-request-id', 'trace-abc-123');

    expect(response.headers['x-request-id']).toBe('trace-abc-123');
    expect(response.body.requestId).toBe('trace-abc-123');
  });

  it('stays 200 even when every dependency is down', async () => {
    // Liveness must never depend on a datastore, otherwise a brief database
    // blip would make an orchestrator kill a healthy process.
    const degraded = createApp({ probes: probesFor({ database: false, redis: false }) });

    const response = await request(degraded).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
  });
});

describe('GET /api/v1/health/ready (readiness)', () => {
  it('returns 200 and per-dependency detail when everything is up', async () => {
    const ready = createApp({ probes: probesFor({ database: true, redis: true }) });

    const response = await request(ready).get('/api/v1/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, message: 'EasyTube API is ready' });
    expect(response.body.data.status).toBe('ready');
    expect(response.body.data.checks.database).toMatchObject({ status: 'up' });
    expect(response.body.data.checks.redis).toMatchObject({ status: 'up' });
  });

  it('returns 503 with the failing dependency named when degraded', async () => {
    const degraded = createApp({ probes: probesFor({ database: true, redis: false }) });

    const response = await request(degraded).get('/api/v1/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      message: 'EasyTube API is not ready.',
      error: { code: 'SERVICE_UNAVAILABLE' },
    });
    expect(response.body.error.details.status).toBe('degraded');
    expect(response.body.error.details.checks.redis.status).toBe('down');
    expect(response.body.error.details.checks.database.status).toBe('up');
  });

  it('reports 503 when nothing is up', async () => {
    const degraded = createApp({ probes: probesFor({ database: false, redis: false }) });

    const response = await request(degraded).get('/api/v1/health/ready');

    expect(response.status).toBe(503);
  });

  it('treats a throwing probe as down rather than failing the request', async () => {
    const throwing = createApp({
      probes: {
        database: () => {
          throw new Error('pool exhausted');
        },
        redis: () => ({ status: 'up' as const, latencyMs: null, detail: 'redis ready' }),
      },
    });

    const response = await request(throwing).get('/api/v1/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.error.details.checks.database.detail).toBe('pool exhausted');
  });

  it('measures probe latency', async () => {
    const ready = createApp({
      probes: {
        database: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { status: 'up' as const, latencyMs: null, detail: 'connected' };
        },
      },
    });

    const response = await request(ready).get('/api/v1/health/ready');

    expect(response.body.data.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(response.body.data.checks.database.latencyMs).toBeLessThan(1_000);
  });
});

describe('security headers', () => {
  it('sets helmet headers and hides the framework fingerprint', async () => {
    const response = await request(app).get('/api/v1/health');

    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
  });
});

describe('unknown routes', () => {
  it('returns a structured 404 envelope', async () => {
    const response = await request(app).get('/api/v1/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(response.body.requestId).toBeDefined();
    expect(response.body.message).toContain('does not exist');
  });
});

describe('service banner', () => {
  it('points at the health route from the root', async () => {
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      health: `${env.API_PREFIX}/health`,
      apiPrefix: env.API_PREFIX,
    });
  });
});

describe('malformed payloads', () => {
  it('returns a structured 400 for invalid JSON', async () => {
    const response = await request(app)
      .post(`${env.API_PREFIX}/health`)
      .set('content-type', 'application/json')
      .send('{"broken":');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, error: { code: 'BAD_REQUEST' } });
  });
});

describe('CORS policy', () => {
  it('allows the configured client origin', async () => {
    const response = await request(app).get('/api/v1/health').set('Origin', env.CLIENT_URL);

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(env.CLIENT_URL);
  });

  it('rejects an unknown origin', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example.com');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
  });
});
