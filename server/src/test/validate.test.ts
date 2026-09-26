import express, { type Express, type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { errorHandler } from '../middleware/errorHandler';
import { requestId } from '../middleware/requestId';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';

type Method = 'get' | 'post' | 'put' | 'delete';

/** Echoes what the handler actually received after validation. */
const echo: RequestHandler = (req, res) => {
  res.json({ body: req.body, query: req.query, params: req.params });
};

/** Registers a route with middleware mounted *on the route*, as in the real routers. */
function route(app: Express, method: Method, path: string, ...middleware: RequestHandler[]): void {
  app[method](path, ...middleware, echo);
}

/**
 * Builds a test app. `errorHandler` is mounted last so that `next(err)` from a
 * route is actually reached by it.
 */
function createTestApp(configure: (app: Express) => void): Express {
  const app = express();
  app.use(requestId);
  app.use(express.json());
  configure(app);
  app.use(errorHandler);
  return app;
}

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1),
  limit: z.coerce.number().int().max(50),
});

const uuidParamSchema = z.object({ id: z.string().uuid() });

const withPagination = validate({ query: paginationSchema });

describe('validate middleware - query', () => {
  it('coerces numeric strings into real numbers', async () => {
    const app = createTestApp((a) => route(a, 'get', '/downloads', withPagination));

    const response = await request(app).get('/downloads?page=2&limit=10');

    expect(response.status).toBe(200);
    expect(response.body.query).toEqual({ page: 2, limit: 10 });
  });

  it('rejects a non-numeric page with a structured 400', async () => {
    const app = createTestApp((a) => route(a, 'get', '/downloads', withPagination));

    const response = await request(app).get('/downloads?page=abc&limit=10');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
    expect(response.body.message).toContain('query');
    expect(response.body.error.details).toHaveProperty('query');
  });

  it('reports a bound violation against the offending field', async () => {
    const app = createTestApp((a) => route(a, 'get', '/downloads', withPagination));

    const response = await request(app).get('/downloads?page=0&limit=10');

    expect(response.status).toBe(400);
    expect(response.body.error.details.query.fieldErrors).toHaveProperty('page');
  });

  it('rejects a value above the maximum', async () => {
    const app = createTestApp((a) => route(a, 'get', '/downloads', withPagination));

    const response = await request(app).get('/downloads?page=1&limit=999');

    expect(response.status).toBe(400);
    expect(response.body.error.details.query.fieldErrors).toHaveProperty('limit');
  });

  it('does not affect an unrelated route', async () => {
    const app = createTestApp((a) => {
      route(a, 'get', '/downloads', withPagination);
      route(a, 'get', '/sources');
    });

    const response = await request(app).get('/sources');

    expect(response.status).toBe(200);
  });
});

describe('validate middleware - body', () => {
  const schema = z.object({ email: z.string().email(), age: z.number().int().min(18) });

  it('accepts a valid payload', async () => {
    const app = createTestApp((a) => route(a, 'post', '/users', validate({ body: schema })));

    const response = await request(app).post('/users').send({ email: 'a@b.com', age: 21 });

    expect(response.status).toBe(200);
  });

  it('returns field errors for an invalid payload', async () => {
    const app = createTestApp((a) => route(a, 'post', '/users', validate({ body: schema })));

    const response = await request(app).post('/users').send({ email: 'nope', age: 12 });

    expect(response.status).toBe(400);
    const fieldErrors = response.body.error.details.body.fieldErrors;
    expect(fieldErrors).toHaveProperty('email');
    expect(fieldErrors).toHaveProperty('age');
  });
});

describe('validate middleware - params', () => {
  it('accepts a valid uuid param', async () => {
    const app = createTestApp((a) => route(a, 'put', '/downloads/:id', validate({ params: uuidParamSchema })));

    const response = await request(app).put('/downloads/3f2504e0-4f89-41d3-9a0c-0305e82c3301');

    expect(response.status).toBe(200);
    expect(response.body.params).toEqual({ id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' });
  });

  it('rejects a malformed uuid param', async () => {
    const app = createTestApp((a) => route(a, 'put', '/downloads/:id', validate({ params: uuidParamSchema })));

    const response = await request(app).put('/downloads/not-a-uuid');

    expect(response.status).toBe(400);
    expect(response.body.error.details).toHaveProperty('params');
  });
});

describe('validate middleware - multiple sections', () => {
  it('reports every failing section in one response', async () => {
    const app = createTestApp((a) =>
      route(
        a,
        'put',
        '/downloads/:id',
        validate({ body: z.object({ name: z.string().min(1) }), params: uuidParamSchema }),
      ),
    );

    const response = await request(app).put('/downloads/not-a-uuid').send({ name: '' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('body');
    expect(response.body.message).toContain('params');
    expect(response.body.error.details).toHaveProperty('body');
    expect(response.body.error.details).toHaveProperty('params');
  });

  it('validates every section in one pass when all are valid', async () => {
    const app = createTestApp((a) =>
      route(
        a,
        'put',
        '/downloads/:id',
        validate({ body: z.object({ name: z.string().min(1) }), params: uuidParamSchema }),
      ),
    );

    const response = await request(app)
      .put('/downloads/3f2504e0-4f89-41d3-9a0c-0305e82c3301')
      .send({ name: 'clip' });

    expect(response.status).toBe(200);
  });
});

describe('validate middleware - passthrough', () => {
  it('leaves sections without a schema untouched', async () => {
    const app = createTestApp((a) => route(a, 'post', '/downloads', withPagination));

    const response = await request(app).post('/downloads?page=1&limit=5').send({ untouched: true });

    expect(response.status).toBe(200);
    expect(response.body.body).toEqual({ untouched: true });
  });

  it('is a no-op when no schemas are supplied', async () => {
    const app = createTestApp((a) => route(a, 'get', '/anything', validate({})));

    const response = await request(app).get('/anything?whatever=1');

    expect(response.status).toBe(200);
  });

  it('rejects unknown keys against a strict body schema', async () => {
    const app = createTestApp((a) =>
      route(a, 'post', '/strict', validate({ body: z.object({ keep: z.string() }).strict() })),
    );

    const response = await request(app).post('/strict').send({ keep: 'yes', extra: 'no' });

    expect(response.status).toBe(400);
  });
});

describe('asyncHandler', () => {
  it('forwards a rejected promise to the error handler', async () => {
    const app = createTestApp((a) =>
      route(
        a,
        'get',
        '/boom',
        asyncHandler(() => Promise.reject(new Error('boom'))),
      ),
    );

    const response = await request(app).get('/boom');

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
  });

  it('resolves a successful async handler', async () => {
    const app = createTestApp((a) =>
      route(
        a,
        'get',
        '/fine',
        asyncHandler((_req, res) => {
          res.json({ ok: true });
          return Promise.resolve();
        }),
      ),
    );

    const response = await request(app).get('/fine');

    expect(response.status).toBe(200);
  });
});
