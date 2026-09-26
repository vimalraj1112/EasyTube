import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { requestId } from '../middleware/requestId';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/respond';

function createTestApp(): Express {
  const app = express();
  app.use(requestId);

  app.get('/ok', (_req, res) => sendSuccess(res, { message: 'all good', data: { id: 1 } }));
  app.get('/created', (_req, res) =>
    sendCreated(res, { message: 'resource created', data: { id: 7 } }, '/api/v1/things/7'),
  );
  app.get('/created-no-location', (_req, res) =>
    sendCreated(res, { message: 'resource created', data: { id: 8 } }),
  );
  app.get('/accepted', (_req, res) =>
    sendSuccess(res, { message: 'queued', data: null, status: 202 }),
  );
  app.delete('/gone', (_req, res) => sendNoContent(res));

  return app;
}

const app = createTestApp();

describe('sendSuccess', () => {
  it('wraps data in the success envelope with a 200', async () => {
    const response = await request(app).get('/ok');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'all good',
      data: { id: 1 },
    });
  });

  it('propagates the request id into the body', async () => {
    const response = await request(app).get('/ok').set('x-request-id', 'req-42');

    expect(response.body.requestId).toBe('req-42');
  });

  it('honours a custom status code', async () => {
    const response = await request(app).get('/accepted');

    expect(response.status).toBe(202);
    expect(response.body.data).toBeNull();
  });
});

describe('sendCreated', () => {
  it('returns 201 with a Location header', async () => {
    const response = await request(app).get('/created');

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ success: true, data: { id: 7 } });
    expect(response.headers.location).toBe('/api/v1/things/7');
  });

  it('omits Location when none is supplied', async () => {
    const response = await request(app).get('/created-no-location');

    expect(response.status).toBe(201);
    expect(response.headers.location).toBeUndefined();
  });
});

describe('sendNoContent', () => {
  it('returns an empty 204', async () => {
    const response = await request(app).delete('/gone');

    expect(response.status).toBe(204);
    expect(response.body).toEqual({});
  });
});
