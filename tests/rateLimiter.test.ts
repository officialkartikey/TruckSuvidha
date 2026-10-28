import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { createApp } from '../src/app';
import { env } from '../src/config/env';

describe('Proxy Trust & Rate Limiting Configuration', () => {
  const app = createApp();

  it('should have Express trust proxy configured according to env.TRUST_PROXY', () => {
    expect(app.get('trust proxy')).toBe(env.TRUST_PROXY);
    expect(app.get('trust proxy')).toBe(1);
  });

  it('should not throw ERR_ERL_UNEXPECTED_X_FORWARDED_FOR when X-Forwarded-For is provided', async () => {
    // Health check endpoint is an un-limited endpoint, but let's test a rate-limited route
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '203.0.113.100')
      .send({ email: 'nonexistent@test.com', password: 'wrongpassword' });

    // Should return 401 (invalid credentials) or 400 (validation), NOT an express-rate-limit validation crash
    expect(res.status).toBe(401);
    expect(res.headers).toHaveProperty('ratelimit-limit');
    expect(res.headers).toHaveProperty('ratelimit-remaining');
  });

  it('should correctly identify the real client IP using the 1 trusted proxy hop from Render', async () => {
    // Test app with trust proxy set to 1
    const testApp = express();
    testApp.set('trust proxy', env.TRUST_PROXY);
    testApp.get('/test-ip', (req: Request, res: Response) => {
      res.json({ ip: req.ip, ips: req.ips });
    });

    // Single client IP added by Render reverse proxy
    const res1 = await request(testApp)
      .get('/test-ip')
      .set('X-Forwarded-For', '203.0.113.50');

    expect(res1.body.ip).toBe('203.0.113.50');
    expect(res1.body.ips).toEqual(['203.0.113.50']);

    // Spoofed X-Forwarded-For chain: client sent '10.0.0.1', Render appended '203.0.113.50'
    const res2 = await request(testApp)
      .get('/test-ip')
      .set('X-Forwarded-For', '10.0.0.1, 203.0.113.50');

    // Express with trust proxy: 1 must select the real client IP (203.0.113.50), NOT the spoofed IP (10.0.0.1)
    expect(res2.body.ip).toBe('203.0.113.50');
  });

  it('should enforce rate limiting and prevent bypass via X-Forwarded-For spoofing', async () => {
    const testApp = express();
    testApp.set('trust proxy', env.TRUST_PROXY);

    const testLimiter = rateLimit({
      windowMs: 60000,
      limit: 2,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({ success: false, error: 'RATE_LIMIT_EXCEEDED' });
      },
    });

    testApp.get('/test-limit', testLimiter, (req: Request, res: Response) => {
      res.json({ success: true, ip: req.ip });
    });

    const realClientIp = '198.51.100.99';

    // Request 1: initial request with spoofed header
    const res1 = await request(testApp)
      .get('/test-limit')
      .set('X-Forwarded-For', `fake-ip-1, ${realClientIp}`);
    expect(res1.status).toBe(200);

    // Request 2: second request with a different spoofed header
    const res2 = await request(testApp)
      .get('/test-limit')
      .set('X-Forwarded-For', `fake-ip-2, ${realClientIp}`);
    expect(res2.status).toBe(200);

    // Request 3: client attempts to bypass rate limiting by changing spoofed IP
    const res3 = await request(testApp)
      .get('/test-limit')
      .set('X-Forwarded-For', `fake-ip-3, ${realClientIp}`);
    expect(res3.status).toBe(429);
    expect(res3.body.error).toBe('RATE_LIMIT_EXCEEDED');

    // A different legitimate client IP should NOT be affected
    const resOther = await request(testApp)
      .get('/test-limit')
      .set('X-Forwarded-For', '203.0.113.222');
    expect(resOther.status).toBe(200);
  });
});
