/**
 * Contract tests: health check and ping endpoints.
 * These tests run against the Express app without a real database or Stytch.
 */
import request from 'supertest';
import app from '../app';

describe('Health endpoints', () => {
  it('GET /health returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('GET /ping returns 200 with pong', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pong: true });
  });

  it('GET /not-found returns 404 with error shape', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('code', 'not_found');
  });
});
