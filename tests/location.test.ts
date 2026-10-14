import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

describe('Location Ingestion & History Module', () => {
  let adminToken: string;
  let deviceApiKey: string;
  const testDeviceId = 'ESP32_001';

  beforeEach(async () => {
    // 1. Register admin
    const authRes = await request(app).post('/api/v1/auth/register').send({
      name: 'Operations Manager',
      email: 'ops@trucksuvidha.com',
      password: 'password123',
    });
    adminToken = authRes.body.data.token;

    // 2. Register device
    const deviceRes = await request(app)
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        deviceId: testDeviceId,
        name: 'Primary Reefer Truck',
      });
    deviceApiKey = deviceRes.body.data.apiKey;
  });

  it('should reject location ingestion without device API key', async () => {
    const res = await request(app).post('/api/v1/device/location').send({
      deviceId: testDeviceId,
      timestamp: new Date().toISOString(),
      latitude: 28.6139,
      longitude: 77.209,
      speed: 45.0,
      gpsFixed: true,
      batteryPercent: 90,
    });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('DEVICE_AUTH_REQUIRED');
  });

  it('should reject location ingestion with invalid device API key', async () => {
    const res = await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', 'trk_invalid_key_12345')
      .send({
        deviceId: testDeviceId,
        timestamp: new Date().toISOString(),
        latitude: 28.6139,
        longitude: 77.209,
        speed: 45.0,
        gpsFixed: true,
        batteryPercent: 90,
      });

    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('INVALID_DEVICE_CREDENTIALS');
  });

  it('should reject invalid GPS payloads (latitude out of range, negative speed, etc.)', async () => {
    const res = await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .send({
        deviceId: testDeviceId,
        timestamp: new Date().toISOString(),
        latitude: 150.0, // Invalid latitude (> 90)
        longitude: 77.209,
        speed: -10, // Invalid negative speed
        gpsFixed: true,
        batteryPercent: 120, // Invalid battery (> 100)
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('should successfully ingest a valid location and update device state', async () => {
    const timestamp = new Date(Date.now() - 1000).toISOString();
    const res = await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .send({
        deviceId: testDeviceId,
        timestamp,
        latitude: 25.5701,
        longitude: 81.5,
        speed: 12.5,
        gpsFixed: true,
        batteryPercent: 85,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.latestLocationUpdated).toBe(true);
    expect(res.body.data.historySaved).toBe(true);
    expect(res.body.data.receivedAt).toBeDefined();

    // Verify device updated state in database
    const deviceRes = await request(app)
      .get(`/api/v1/devices/${testDeviceId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(deviceRes.status).toBe(200);
    expect(deviceRes.body.data.status).toBe('online');
    expect(deviceRes.body.data.batteryPercent).toBe(85);
    expect(deviceRes.body.data.latestLocation.latitude).toBe(25.5701);
    expect(deviceRes.body.data.latestLocation.longitude).toBe(81.5);
    expect(deviceRes.body.data.latestLocation.speed).toBe(12.5);
    expect(deviceRes.body.data.latestLocation.gpsFixed).toBe(true);
  });

  it('should preserve coordinates when gpsFixed is false, but update lastSeenAt and battery', async () => {
    // 1. Send an initial fix
    const initialTime = new Date(Date.now() - 5000).toISOString();
    await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .send({
        deviceId: testDeviceId,
        timestamp: initialTime,
        latitude: 25.5701,
        longitude: 81.5,
        speed: 10,
        gpsFixed: true,
        batteryPercent: 90,
      });

    // 2. Send an update with gpsFixed = false (e.g. truck in underground garage)
    const laterTime = new Date().toISOString();
    const res = await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .send({
        deviceId: testDeviceId,
        timestamp: laterTime,
        latitude: 0,
        longitude: 0,
        speed: 0,
        gpsFixed: false,
        batteryPercent: 82,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.gpsFixed).toBe(false);
    expect(res.body.data.latestLocationUpdated).toBe(false);

    // Verify the previous valid coordinates are still intact
    const deviceRes = await request(app)
      .get(`/api/v1/devices/${testDeviceId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(deviceRes.body.data.batteryPercent).toBe(82);
    expect(deviceRes.body.data.latestLocation.latitude).toBe(25.5701);
    expect(deviceRes.body.data.latestLocation.longitude).toBe(81.5);
  });

  it('should prevent duplicate events with identical timestamps from duplicating history', async () => {
    const fixedTimestamp = new Date(Date.now() - 3000).toISOString();
    const payload = {
      deviceId: testDeviceId,
      timestamp: fixedTimestamp,
      latitude: 25.5701,
      longitude: 81.5,
      speed: 15,
      gpsFixed: true,
      batteryPercent: 80,
    };

    // First ingestion
    const res1 = await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .send(payload);

    expect(res1.body.data.historySaved).toBe(true);

    // Re-send identical timestamp event (e.g. firmware retransmission retry)
    const res2 = await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .send(payload);

    expect(res2.status).toBe(200);
    expect(res2.body.data.historySaved).toBe(false);

    // Confirm only 1 entry exists in location history
    const historyRes = await request(app)
      .get(`/api/v1/devices/${testDeviceId}/locations`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(historyRes.body.data.length).toBe(1);
  });

  it('should handle out-of-order locations: delayed buffered locations save to history but do NOT overwrite newer latestLocation', async () => {
    const tNewer = new Date(Date.now() - 1000).toISOString();
    const tOlder = new Date(Date.now() - 10000).toISOString();

    // 1. Ingest newer location first (e.g., live reception after connection restored)
    await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .send({
        deviceId: testDeviceId,
        timestamp: tNewer,
        latitude: 28.7041, // Delhi
        longitude: 77.1025,
        speed: 60,
        gpsFixed: true,
        batteryPercent: 75,
      });

    // 2. Ingest older buffered location (e.g., buffered during cellular tunnel dropout)
    const resOlder = await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .send({
        deviceId: testDeviceId,
        timestamp: tOlder,
        latitude: 26.8467, // Lucknow
        longitude: 80.9462,
        speed: 55,
        gpsFixed: true,
        batteryPercent: 78,
      });

    expect(resOlder.status).toBe(200);
    expect(resOlder.body.data.historySaved).toBe(true);
    // Crucial: latestLocation must NOT be overwritten by older timestamp!
    expect(resOlder.body.data.latestLocationUpdated).toBe(false);

    // Verify latestLocation still reflects Delhi (the newer point)
    const deviceRes = await request(app)
      .get(`/api/v1/devices/${testDeviceId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(deviceRes.body.data.latestLocation.latitude).toBe(28.7041);
    expect(deviceRes.body.data.latestLocation.longitude).toBe(77.1025);

    // Verify history has both entries
    const historyRes = await request(app)
      .get(`/api/v1/devices/${testDeviceId}/locations`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(historyRes.body.data.length).toBe(2);
  });
});
