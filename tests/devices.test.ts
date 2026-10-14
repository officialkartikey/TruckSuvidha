import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

describe('Device Management Module', () => {
  let tokenAdmin1: string;
  let tokenAdmin2: string;

  beforeEach(async () => {
    // Register Admin 1
    const res1 = await request(app).post('/api/v1/auth/register').send({
      name: 'Admin One',
      email: 'admin1@fleet.com',
      password: 'password123',
    });
    tokenAdmin1 = res1.body.data.token;

    // Register Admin 2
    const res2 = await request(app).post('/api/v1/auth/register').send({
      name: 'Admin Two',
      email: 'admin2@fleet.com',
      password: 'password123',
    });
    tokenAdmin2 = res2.body.data.token;
  });

  it('should allow an admin to register a new device and return an API key', async () => {
    const res = await request(app)
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${tokenAdmin1}`)
      .send({
        deviceId: 'TRUCK_101',
        name: 'Heavy Hauler #101',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.device.deviceId).toBe('TRUCK_101');
    expect(res.body.data.device.name).toBe('Heavy Hauler #101');
    expect(res.body.data.device.status).toBe('offline');
    expect(res.body.data.apiKey).toBeDefined();
    expect(res.body.data.apiKey.startsWith('trk_')).toBe(true);
  });

  it('should reject registering a duplicate deviceId', async () => {
    // First registration
    await request(app)
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${tokenAdmin1}`)
      .send({
        deviceId: 'TRUCK_101',
        name: 'Heavy Hauler #101',
      });

    // Duplicate attempt
    const res = await request(app)
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${tokenAdmin1}`)
      .send({
        deviceId: 'truck_101', // case-insensitive check
        name: 'Duplicate Hauler',
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('DEVICE_ALREADY_EXISTS');
  });

  it('should enforce strict ownership: Admin cannot access or modify another admin’s device', async () => {
    // Admin 1 registers device
    await request(app)
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${tokenAdmin1}`)
      .send({
        deviceId: 'SECURE_TRUCK_1',
        name: 'Truck 1',
      });

    // Admin 2 tries to GET Admin 1's device
    const getRes = await request(app)
      .get('/api/v1/devices/SECURE_TRUCK_1')
      .set('Authorization', `Bearer ${tokenAdmin2}`);

    expect(getRes.status).toBe(403);
    expect(getRes.body.error?.code).toBe('FORBIDDEN');

    // Admin 2 tries to PATCH Admin 1's device
    const patchRes = await request(app)
      .patch('/api/v1/devices/SECURE_TRUCK_1')
      .set('Authorization', `Bearer ${tokenAdmin2}`)
      .send({ name: 'Hacked Name' });

    expect(patchRes.status).toBe(403);

    // Admin 2 tries to DELETE Admin 1's device
    const deleteRes = await request(app)
      .delete('/api/v1/devices/SECURE_TRUCK_1')
      .set('Authorization', `Bearer ${tokenAdmin2}`);

    expect(deleteRes.status).toBe(403);

    // Admin 2 listing devices should not include Admin 1's device
    const listRes = await request(app)
      .get('/api/v1/devices')
      .set('Authorization', `Bearer ${tokenAdmin2}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBe(0);
  });

  it('should allow owner admin to update device name', async () => {
    await request(app)
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${tokenAdmin1}`)
      .send({
        deviceId: 'TRUCK_UPDATE',
        name: 'Old Name',
      });

    const res = await request(app)
      .patch('/api/v1/devices/TRUCK_UPDATE')
      .set('Authorization', `Bearer ${tokenAdmin1}`)
      .send({ name: 'Updated Hauler Express' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Hauler Express');
  });

  it('should allow owner admin to delete their device', async () => {
    await request(app)
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${tokenAdmin1}`)
      .send({
        deviceId: 'TRUCK_DELETE',
        name: 'To Delete',
      });

    const res = await request(app)
      .delete('/api/v1/devices/TRUCK_DELETE')
      .set('Authorization', `Bearer ${tokenAdmin1}`);

    expect(res.status).toBe(200);

    // Confirm device is no longer found
    const getRes = await request(app)
      .get('/api/v1/devices/TRUCK_DELETE')
      .set('Authorization', `Bearer ${tokenAdmin1}`);

    expect(getRes.status).toBe(404);
  });
});
