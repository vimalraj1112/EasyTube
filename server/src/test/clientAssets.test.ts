import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Application } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { env } from '../config/env';
import { isApiRequest, resolveClientDist } from '../middleware/clientAssets';

/**
 * A real directory with real files, because the behaviour under test is
 * filesystem behaviour: whether `index.html` exists, and whether `express.static`
 * can find a hashed asset. A mocked fs would pass while the deploy 404s.
 */
let distDir: string;

beforeAll(() => {
  distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easytube-client-'));
  fs.writeFileSync(
    path.join(distDir, 'index.html'),
    '<!doctype html><title>EasyTube</title><div id="root"></div>',
  );
  fs.mkdirSync(path.join(distDir, 'assets'));
  fs.writeFileSync(path.join(distDir, 'assets', 'index-abc123.js'), 'console.log("bundle")');
});

afterAll(() => {
  fs.rmSync(distDir, { recursive: true, force: true });
});

describe('isApiRequest', () => {
  it('matches the API prefix exactly, without trailing-slash fallthrough', () => {
    expect(isApiRequest('/api/v1', '/api/v1')).toBe(true);
    expect(isApiRequest('/api/v1/', '/api/v1')).toBe(true);
    expect(isApiRequest('/api/v1/health', '/api/v1')).toBe(true);
  });

  it('does not match client routes or a similarly named prefix', () => {
    expect(isApiRequest('/', '/api/v1')).toBe(false);
    expect(isApiRequest('/login', '/api/v1')).toBe(false);
    expect(isApiRequest('/api/v2/health', '/api/v1')).toBe(false);
  });
});

describe('resolveClientDist', () => {
  it('returns the directory when a client build is present', () => {
    expect(resolveClientDist(distDir)).toBe(path.resolve(distDir));
  });

  it('returns null when the build is missing, rather than serving a broken shell', () => {
    expect(resolveClientDist(path.join(os.tmpdir(), 'easytube-does-not-exist'))).toBeNull();
  });
});

describe('serveClient', () => {
  it('reports false and mounts nothing when there is no build', () => {
    expect(resolveClientDist(path.join(os.tmpdir(), 'easytube-missing'))).toBeNull();
  });
});

describe('API serving the client build', () => {
  /**
   * Built through `createApp` rather than by calling `serveClient` afterwards:
   * mounting it post-hoc would place it after `notFoundHandler`, which answers
   * first. Middleware order is the thing under test, so the app has to be
   * assembled the way production assembles it.
   */
  function appWithClient(): Application {
    const original = env.SERVE_CLIENT;
    (env as { SERVE_CLIENT: boolean }).SERVE_CLIENT = true;
    try {
      return createApp({ clientDistDir: distDir });
    } finally {
      (env as { SERVE_CLIENT: boolean }).SERVE_CLIENT = original;
    }
  }

  it('serves the SPA shell for a client route', async () => {
    const response = await request(appWithClient()).get('/login');

    expect(response.status).toBe(200);
    expect(response.text).toContain('<div id="root">');
    expect(response.headers['content-type']).toMatch(/text\/html/);
  });

  it('serves a hashed asset with a long-lived cache header', async () => {
    const response = await request(appWithClient()).get('/assets/index-abc123.js');

    expect(response.status).toBe(200);
    expect(response.text).toContain('bundle');
    expect(response.headers['cache-control']).toContain('immutable');
  });

  it('marks index.html uncacheable so a stale shell cannot pin an old bundle', async () => {
    const response = await request(appWithClient()).get('/login');

    expect(response.headers['cache-control']).toContain('no-cache');
  });

  it('still serves API routes as JSON', async () => {
    const response = await request(appWithClient()).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
  });

  it('returns the JSON 404 envelope for an unknown API path, never the shell', async () => {
    const response = await request(appWithClient()).get('/api/v1/nope');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body.success).toBe(false);
  });

  it('returns the JSON 404 envelope for a non-GET request to an unknown path', async () => {
    const response = await request(appWithClient()).post('/not-a-route');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });
});

describe('SERVE_CLIENT', () => {
  it('is off by default, leaving the API JSON-only', async () => {
    expect(env.SERVE_CLIENT).toBe(false);

    const response = await request(createApp()).get('/login');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });
});
