import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

describe('Admin Authentication Module', () => {
  const adminData = {
    name: 'Fleet Manager',
    email: 'admin@trucksuvidha.com',
    password: 'securePassword123!',
  };

  it('should register a new admin successfully and issue a JWT token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(adminData);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.admin).toBeDefined();
    expect(res.body.data.admin.email).toBe(adminData.email);
    expect(res.body.data.admin.name).toBe(adminData.name);
    expect(res.body.data.admin.passwordHash).toBeUndefined();
    expect(res.body.data.token).toBeDefined();
    expect(typeof res.body.data.token).toBe('string');
  });

  it('should reject registration with duplicate email', async () => {
    // First registration
    await request(app).post('/api/v1/auth/register').send(adminData);

    // Duplicate registration attempt
    const res = await request(app).post('/api/v1/auth/register').send(adminData);

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('EMAIL_EXISTS');
  });

  it('should reject registration with invalid email or weak password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'A',
        email: 'not-an-email',
        password: '123',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('should login an existing admin with correct credentials', async () => {
    await request(app).post('/api/v1/auth/register').send(adminData);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: adminData.email,
        password: adminData.password,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.admin.email).toBe(adminData.email);
    expect(res.body.data.token).toBeDefined();
  });

  it('should reject login with wrong password', async () => {
    await request(app).post('/api/v1/auth/register').send(adminData);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: adminData.email,
        password: 'wrongPassword',
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('INVALID_CREDENTIALS');
  });

  it('should reject login with non-existent email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'ghost@trucksuvidha.com',
        password: 'password123',
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('INVALID_CREDENTIALS');
  });
});
