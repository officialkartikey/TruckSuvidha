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
    expect(res.body.error?.code).toBe('LOCATION_VALIDATION_FAILED');
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

  it('should successfully ingest location behind reverse proxy with X-Forwarded-For without ERR_ERL_UNEXPECTED_X_FORWARDED_FOR', async () => {
    const timestamp = new Date().toISOString();
    const res = await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .set('X-Forwarded-For', '203.0.113.195')
      .send({
        deviceId: testDeviceId,
        timestamp,
        latitude: 19.076,
        longitude: 72.8777,
        speed: 35.0,
        gpsFixed: true,
        batteryPercent: 92,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.latestLocationUpdated).toBe(true);
  });

  it('should safely process location ingestion when X-Forwarded-For contains multiple proxy hops / spoofed IPs', async () => {
    const timestamp = new Date(Date.now() + 1000).toISOString();
    const res = await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .set('X-Forwarded-For', '198.51.100.42, 203.0.113.195')
      .send({
        deviceId: testDeviceId,
        timestamp,
        latitude: 19.078,
        longitude: 72.879,
        speed: 40.0,
        gpsFixed: true,
        batteryPercent: 91,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.latestLocationUpdated).toBe(true);
  });

  // --- ESP32 Specific Production Tests ---

  it('1. should successfully ingest a valid ESP32 payload with snake_case fields and seq', async () => {
    const timestamp = new Date(Date.now() - 2000).toISOString();
    const res = await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .send({
        device_id: testDeviceId,
        seq: 1,
        latitude: 28.676575,
        longitude: 77.501905,
        speed_kmph: 2.54,
        gps_utc: timestamp,
        fix_valid: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.requestId).toBeDefined();
    expect(res.body.data.deviceId).toBe(testDeviceId);
    expect(res.body.data.latestLocationUpdated).toBe(true);
    expect(res.body.data.historySaved).toBe(true);
  });

  it('2. should reject payload with missing required fields (e.g. missing latitude or coordinates)', async () => {
    const res = await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .send({
        device_id: testDeviceId,
        speed_kmph: 10.5,
        gps_utc: new Date().toISOString(),
        fix_valid: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('LOCATION_VALIDATION_FAILED');
    expect(res.body.error?.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: expect.stringMatching(/latitude/) }),
        expect.objectContaining({ field: expect.stringMatching(/longitude/) }),
      ])
    );
  });

  it('3. should reject invalid coordinates (out of range) and invalid field types', async () => {
    const res = await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .send({
        device_id: testDeviceId,
        latitude: 'not-a-number',
        longitude: 200.0, // Invalid longitude (> 180)
        speed_kmph: -5,
        gps_utc: new Date().toISOString(),
        fix_valid: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('LOCATION_VALIDATION_FAILED');
  });

  it('4. should reject invalid or stale GPS timestamps and future timestamps', async () => {
    // 4a. Malformed timestamp
    const resMalformed = await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .send({
        device_id: testDeviceId,
        latitude: 28.6139,
        longitude: 77.209,
        speed_kmph: 10,
        gps_utc: 'invalid-date-string',
        fix_valid: true,
      });

    expect(resMalformed.status).toBe(400);
    expect(resMalformed.body.error?.code).toBe('LOCATION_VALIDATION_FAILED');

    // 4b. Stale timestamp (older than 24 hours)
    const staleTime = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const resStale = await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .send({
        device_id: testDeviceId,
        latitude: 28.6139,
        longitude: 77.209,
        speed_kmph: 10,
        gps_utc: staleTime,
        fix_valid: true,
      });

    expect(resStale.status).toBe(400);
    expect(resStale.body.error?.code).toBe('LOCATION_VALIDATION_FAILED');
    expect(resStale.body.error?.details[0].message).toContain('stale');

    // 4c. Timestamp in future (> 15 minutes)
    const futureTime = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const resFuture = await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .send({
        device_id: testDeviceId,
        latitude: 28.6139,
        longitude: 77.209,
        speed_kmph: 10,
        gps_utc: futureTime,
        fix_valid: true,
      });

    expect(resFuture.status).toBe(400);
    expect(resFuture.body.error?.code).toBe('LOCATION_VALIDATION_FAILED');
    expect(resFuture.body.error?.details[0].message).toContain('future');
  });

  it('5. should reject unknown device with 404 and unauthorized device with 401', async () => {
    // 5a. Unknown device (not registered)
    const resUnknown = await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .send({
        device_id: 'UNKNOWN_DEVICE_999',
        latitude: 28.6139,
        longitude: 77.209,
        speed_kmph: 10,
        gps_utc: new Date().toISOString(),
        fix_valid: true,
      });

    expect(resUnknown.status).toBe(404);
    expect(resUnknown.body.error?.code).toBe('DEVICE_NOT_FOUND');

    // 5b. Unauthorized device (invalid API key)
    const resUnauthorized = await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', 'trk_wrong_api_key_xyz')
      .send({
        device_id: testDeviceId,
        latitude: 28.6139,
        longitude: 77.209,
        speed_kmph: 10,
        gps_utc: new Date().toISOString(),
        fix_valid: true,
      });

    expect(resUnauthorized.status).toBe(401);
    expect(resUnauthorized.body.error?.code).toBe('INVALID_DEVICE_CREDENTIALS');
  });

  it('6. should reject duplicate sequence numbers with HTTP 409', async () => {
    const time1 = new Date(Date.now() - 4000).toISOString();
    const time2 = new Date(Date.now() - 3000).toISOString();

    // First request with seq: 100
    const res1 = await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .send({
        device_id: testDeviceId,
        seq: 100,
        latitude: 28.6139,
        longitude: 77.209,
        speed_kmph: 20,
        gps_utc: time1,
        fix_valid: true,
      });
    expect(res1.status).toBe(200);

    // Duplicate request with the exact same seq: 100
    const res2 = await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .send({
        device_id: testDeviceId,
        seq: 100,
        latitude: 28.614,
        longitude: 77.21,
        speed_kmph: 22,
        gps_utc: time2,
        fix_valid: true,
      });

    expect(res2.status).toBe(409);
    expect(res2.body.success).toBe(false);
    expect(res2.body.error?.code).toBe('DUPLICATE_SEQUENCE_NUMBER');
  });

  it('7. should handle database validation / persistence failures with HTTP 500 and never return 200', async () => {
    const { locationsService } = await import('../src/modules/locations/locations.service');
    const spy = vi.spyOn(locationsService, 'processLocation').mockRejectedValueOnce(new Error('Simulated DB failure'));

    const res = await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .send({
        device_id: testDeviceId,
        seq: 999,
        latitude: 28.6139,
        longitude: 77.209,
        speed_kmph: 15,
        gps_utc: new Date().toISOString(),
        fix_valid: true,
      });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('INTERNAL_SERVER_ERROR');
    // Ensure internal stack trace is NOT exposed in HTTP response
    expect(res.body.stack).toBeUndefined();
    expect(res.body.error?.stack).toBeUndefined();

    spy.mockRestore();
  });

  it('8. should return HTTP 400 for malformed JSON request body', async () => {
    const res = await request(app)
      .post('/api/v1/device/location')
      .set('Content-Type', 'application/json')
      .set('x-device-key', deviceApiKey)
      .send('{"device_id": "ESP32_001", invalid_json');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('BAD_JSON');
  });

  it('9. should handle unexpected internal errors gracefully without leaking internals', async () => {
    const { LocationHistory } = await import('../src/modules/locations/locationHistory.model');
    const spy = vi.spyOn(LocationHistory, 'findOne').mockImplementationOnce(() => {
      throw new Error('Unexpected fatal crash');
    });

    const res = await request(app)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .send({
        device_id: testDeviceId,
        seq: 555,
        latitude: 28.6139,
        longitude: 77.209,
        speed_kmph: 10,
        gps_utc: new Date().toISOString(),
        fix_valid: true,
      });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('INTERNAL_SERVER_ERROR');
    expect(res.body.error?.stack).toBeUndefined();

    spy.mockRestore();
  });

  describe('Device Authentication & Verification Matrix', () => {
    it('should authenticate device using Authorization: Bearer <token>', async () => {
      const timestamp = new Date(Date.now() - 500).toISOString();
      const res = await request(app)
        .post('/api/v1/device/location')
        .set('Authorization', `Bearer ${deviceApiKey}`)
        .send({
          device_id: testDeviceId,
          seq: 601,
          latitude: 28.6139,
          longitude: 77.209,
          speed_kmph: 35.5,
          gps_utc: timestamp,
          fix_valid: true,
          battery_percent: 88,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deviceId).toBe(testDeviceId);
      expect(res.body.data.latestLocationUpdated).toBe(true);
      expect(res.body.data.historySaved).toBe(true);
    });

    it('should authenticate device using case-insensitive Authorization: bearer <token>', async () => {
      const timestamp = new Date(Date.now() - 400).toISOString();
      const res = await request(app)
        .post('/api/v1/device/location')
        .set('Authorization', `bearer ${deviceApiKey}`)
        .send({
          device_id: testDeviceId,
          seq: 602,
          latitude: 28.6139,
          longitude: 77.209,
          speed_kmph: 32.0,
          gps_utc: timestamp,
          fix_valid: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.latestLocationUpdated).toBe(true);
    });

    it('should authenticate device using body apiKey or api_key', async () => {
      const timestamp = new Date(Date.now() - 300).toISOString();
      const res = await request(app)
        .post('/api/v1/device/location')
        .send({
          device_id: testDeviceId,
          api_key: deviceApiKey,
          seq: 603,
          latitude: 28.6139,
          longitude: 77.209,
          speed_kmph: 40.0,
          gps_utc: timestamp,
          fix_valid: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.latestLocationUpdated).toBe(true);
    });

    it('should reject location ingestion when API key is empty or whitespace-only', async () => {
      const res = await request(app)
        .post('/api/v1/device/location')
        .set('x-device-key', '   ')
        .send({
          device_id: testDeviceId,
          latitude: 28.6139,
          longitude: 77.209,
          speed_kmph: 20,
          gps_utc: new Date().toISOString(),
          fix_valid: true,
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe('DEVICE_AUTH_REQUIRED');
    });

    it('should reject unauthorized cross-device credential usage (Device A key with Device B ID)', async () => {
      // Register Device B
      const deviceBRes = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          deviceId: 'ESP32_002',
          name: 'Secondary Fleet Truck',
        });
      expect(deviceBRes.status).toBe(201);

      // Attempt to access Device B using Device A's key
      const res = await request(app)
        .post('/api/v1/device/location')
        .set('x-device-key', deviceApiKey) // Device A's key
        .send({
          device_id: 'ESP32_002', // Device B's ID
          latitude: 28.6139,
          longitude: 77.209,
          speed_kmph: 30,
          gps_utc: new Date().toISOString(),
          fix_valid: true,
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe('INVALID_DEVICE_CREDENTIALS');
    });

    it('should reject request when x-device-id header and body device_id conflict', async () => {
      const res = await request(app)
        .post('/api/v1/device/location')
        .set('x-device-key', deviceApiKey)
        .set('x-device-id', 'ESP32_001')
        .send({
          device_id: 'ESP32_MISMATCH',
          latitude: 28.6139,
          longitude: 77.209,
          speed_kmph: 25,
          gps_utc: new Date().toISOString(),
          fix_valid: true,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe('DEVICE_ID_MISMATCH');
    });

    it('should verify actual database persistence in MongoDB Device and LocationHistory collections', async () => {
      const { Device } = await import('../src/modules/devices/device.model');
      const { LocationHistory } = await import('../src/modules/locations/locationHistory.model');

      const fixedTime = new Date(Date.now() - 1500);
      const testSeq = 777;

      const res = await request(app)
        .post('/api/v1/device/location')
        .set('x-device-key', deviceApiKey)
        .send({
          device_id: testDeviceId,
          seq: testSeq,
          latitude: 28.5355,
          longitude: 77.391,
          speed_kmph: 52.4,
          gps_utc: fixedTime.toISOString(),
          fix_valid: true,
          battery_percent: 74,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify persistence directly in Device collection
      const persistedDevice = await Device.findOne({ deviceId: testDeviceId });
      expect(persistedDevice).not.toBeNull();
      expect(persistedDevice!.status).toBe('online');
      expect(persistedDevice!.batteryPercent).toBe(74);
      expect(persistedDevice!.lastSeq).toBe(testSeq);
      expect(persistedDevice!.lastSeenAt).toBeDefined();
      expect(persistedDevice!.latestLocation).toBeDefined();
      expect(persistedDevice!.latestLocation!.latitude).toBe(28.5355);
      expect(persistedDevice!.latestLocation!.longitude).toBe(77.391);
      expect(persistedDevice!.latestLocation!.speed).toBe(52.4);
      expect(persistedDevice!.latestLocation!.gpsFixed).toBe(true);
      expect(new Date(persistedDevice!.latestLocation!.timestamp).getTime()).toBe(fixedTime.getTime());

      // Verify persistence directly in LocationHistory collection
      const persistedHistory = await LocationHistory.findOne({
        deviceId: testDeviceId,
        seq: testSeq,
      });
      expect(persistedHistory).not.toBeNull();
      expect(persistedHistory!.latitude).toBe(28.5355);
      expect(persistedHistory!.longitude).toBe(77.391);
      expect(persistedHistory!.speed).toBe(52.4);
      expect(new Date(persistedHistory!.timestamp).getTime()).toBe(fixedTime.getTime());
      expect(persistedHistory!.receivedAt).toBeDefined();
    });
  });

  describe('Sequence Number Management, Idempotency & Reboot Tests', () => {
    it('should handle repeated identical device ID + sequence requests idempotently without inserting duplicates', async () => {
      const { LocationHistory } = await import('../src/modules/locations/locationHistory.model');
      const time = new Date(Date.now() - 3000).toISOString();
      const payload = {
        device_id: testDeviceId,
        seq: 101,
        latitude: 28.6139,
        longitude: 77.209,
        speed_kmph: 15.0,
        gps_utc: time,
        fix_valid: true,
        battery_percent: 85,
      };

      // 1. First transmission
      const res1 = await request(app)
        .post('/api/v1/device/location')
        .set('x-device-key', deviceApiKey)
        .send(payload);

      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);
      expect(res1.body.data.historySaved).toBe(true);

      // 2. Exact identical retry (same deviceId, seq, and timestamp)
      const res2 = await request(app)
        .post('/api/v1/device/location')
        .set('x-device-key', deviceApiKey)
        .send(payload);

      expect(res2.status).toBe(200);
      expect(res2.body.success).toBe(true);
      expect(res2.body.data.historySaved).toBe(false);
      expect(res2.body.data.latestLocationUpdated).toBe(false);
      expect(res2.body.message).toContain('Duplicate telemetry retry acknowledged');

      // Verify only 1 document exists in LocationHistory
      const count = await LocationHistory.countDocuments({
        deviceId: testDeviceId,
        seq: 101,
      });
      expect(count).toBe(1);
    });

    it('should accept the same sequence number from different devices independently', async () => {
      // Register Device B under admin
      const devBRes = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          deviceId: 'DEVICE_B_SCOPED',
          name: 'Device B',
        });
      expect(devBRes.status).toBe(201);
      const devBKey = devBRes.body.data.apiKey;

      const timeA = new Date(Date.now() - 2000).toISOString();
      const timeB = new Date(Date.now() - 1900).toISOString();

      // Device A sends seq: 201
      const resA = await request(app)
        .post('/api/v1/device/location')
        .set('x-device-key', deviceApiKey)
        .send({
          device_id: testDeviceId,
          seq: 201,
          latitude: 28.6139,
          longitude: 77.209,
          speed_kmph: 20,
          gps_utc: timeA,
          fix_valid: true,
        });
      expect(resA.status).toBe(200);

      // Device B sends the exact same seq: 201
      const resB = await request(app)
        .post('/api/v1/device/location')
        .set('x-device-key', devBKey)
        .send({
          device_id: 'DEVICE_B_SCOPED',
          seq: 201,
          latitude: 19.076,
          longitude: 72.8777,
          speed_kmph: 30,
          gps_utc: timeB,
          fix_valid: true,
        });
      expect(resB.status).toBe(200);
      expect(resB.body.data.deviceId).toBe('DEVICE_B_SCOPED');
    });

    it('should successfully process new sequential location updates', async () => {
      const { Device } = await import('../src/modules/devices/device.model');

      const time1 = new Date(Date.now() - 3000).toISOString();
      const time2 = new Date(Date.now() - 2000).toISOString();
      const time3 = new Date(Date.now() - 1000).toISOString();

      const res1 = await request(app)
        .post('/api/v1/device/location')
        .set('x-device-key', deviceApiKey)
        .send({
          device_id: testDeviceId,
          seq: 1,
          latitude: 28.61,
          longitude: 77.20,
          speed_kmph: 10,
          gps_utc: time1,
          fix_valid: true,
        });
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .post('/api/v1/device/location')
        .set('x-device-key', deviceApiKey)
        .send({
          device_id: testDeviceId,
          seq: 2,
          latitude: 28.62,
          longitude: 77.21,
          speed_kmph: 15,
          gps_utc: time2,
          fix_valid: true,
        });
      expect(res2.status).toBe(200);

      const res3 = await request(app)
        .post('/api/v1/device/location')
        .set('x-device-key', deviceApiKey)
        .send({
          device_id: testDeviceId,
          seq: 3,
          latitude: 28.63,
          longitude: 77.22,
          speed_kmph: 20,
          gps_utc: time3,
          fix_valid: true,
        });
      expect(res3.status).toBe(200);

      const dev = await Device.findOne({ deviceId: testDeviceId });
      expect(dev!.lastSeq).toBe(3);
      expect(dev!.latestLocation!.latitude).toBe(28.63);
    });

    it('should handle out-of-order sequence numbers from delayed buffered uploads without overwriting latestLocation or corrupting lastSeq', async () => {
      const { Device } = await import('../src/modules/devices/device.model');

      const timeLive = new Date(Date.now() - 1000).toISOString();
      const timeBuffered = new Date(Date.now() - 10000).toISOString();

      // 1. Live point arrives first with seq: 50
      const resLive = await request(app)
        .post('/api/v1/device/location')
        .set('x-device-key', deviceApiKey)
        .send({
          device_id: testDeviceId,
          seq: 50,
          latitude: 28.7041,
          longitude: 77.1025,
          speed_kmph: 60,
          gps_utc: timeLive,
          fix_valid: true,
        });
      expect(resLive.status).toBe(200);
      expect(resLive.body.data.latestLocationUpdated).toBe(true);

      // 2. Older buffered point arrives with seq: 40 and older timestamp
      const resBuffered = await request(app)
        .post('/api/v1/device/location')
        .set('x-device-key', deviceApiKey)
        .send({
          device_id: testDeviceId,
          seq: 40,
          latitude: 26.8467,
          longitude: 80.9462,
          speed_kmph: 45,
          gps_utc: timeBuffered,
          fix_valid: true,
        });
      expect(resBuffered.status).toBe(200);
      expect(resBuffered.body.data.historySaved).toBe(true);
      expect(resBuffered.body.data.latestLocationUpdated).toBe(false);

      // Verify device state: latestLocation remains the live point, lastSeq remains 50
      const dev = await Device.findOne({ deviceId: testDeviceId });
      expect(dev!.latestLocation!.latitude).toBe(28.7041);
      expect(dev!.lastSeq).toBe(50);
    });

    it('should handle ESP32 reboot and sequence counter reset without returning duplicate sequence error', async () => {
      const { Device } = await import('../src/modules/devices/device.model');

      const timePast = new Date(Date.now() - 5000).toISOString();
      const timeReboot1 = new Date(Date.now() - 2000).toISOString();
      const timeReboot2 = new Date(Date.now() - 1000).toISOString();

      // Device runs before reboot and reaches seq: 80
      const resPast = await request(app)
        .post('/api/v1/device/location')
        .set('x-device-key', deviceApiKey)
        .send({
          device_id: testDeviceId,
          seq: 80,
          latitude: 28.6139,
          longitude: 77.209,
          speed_kmph: 25,
          gps_utc: timePast,
          fix_valid: true,
        });
      expect(resPast.status).toBe(200);

      // Device reboots! Sequence resets to 1, but timestamp is newer
      const resReboot1 = await request(app)
        .post('/api/v1/device/location')
        .set('x-device-key', deviceApiKey)
        .send({
          device_id: testDeviceId,
          seq: 1,
          latitude: 28.6145,
          longitude: 77.210,
          speed_kmph: 5,
          gps_utc: timeReboot1,
          fix_valid: true,
        });

      // Must succeed with 200 (NOT fail with 409!)
      expect(resReboot1.status).toBe(200);
      expect(resReboot1.body.success).toBe(true);
      expect(resReboot1.body.data.latestLocationUpdated).toBe(true);

      // Follow-up sequential point after reboot
      const resReboot2 = await request(app)
        .post('/api/v1/device/location')
        .set('x-device-key', deviceApiKey)
        .send({
          device_id: testDeviceId,
          seq: 2,
          latitude: 28.6150,
          longitude: 77.211,
          speed_kmph: 12,
          gps_utc: timeReboot2,
          fix_valid: true,
        });
      expect(resReboot2.status).toBe(200);

      const dev = await Device.findOne({ deviceId: testDeviceId });
      expect(dev!.lastSeq).toBe(2);
      expect(dev!.latestLocation!.latitude).toBe(28.6150);
    });

    it('should handle concurrent duplicate requests safely without crashing or creating duplicates', async () => {
      const { LocationHistory } = await import('../src/modules/locations/locationHistory.model');
      const fixedTime = new Date(Date.now() - 1200).toISOString();
      const payload = {
        device_id: testDeviceId,
        seq: 555,
        latitude: 28.65,
        longitude: 77.25,
        speed_kmph: 30,
        gps_utc: fixedTime,
        fix_valid: true,
      };

      // Dispatch 2 concurrent identical requests
      const [res1, res2] = await Promise.all([
        request(app).post('/api/v1/device/location').set('x-device-key', deviceApiKey).send(payload),
        request(app).post('/api/v1/device/location').set('x-device-key', deviceApiKey).send(payload),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // Exactly 1 history entry should exist
      const count = await LocationHistory.countDocuments({
        deviceId: testDeviceId,
        seq: 555,
      });
      expect(count).toBe(1);
    });

    it('should avoid emitting Socket.IO location updates if database persistence fails', async () => {
      const { Device } = await import('../src/modules/devices/device.model');
      const { socketService } = await import('../src/modules/realtime/socket.service');

      const emitLocationSpy = vi.spyOn(socketService, 'emitLocationUpdate');
      const emitStatusSpy = vi.spyOn(socketService, 'emitDeviceStatus');

      // Mock Device.prototype.save to reject
      const saveSpy = vi.spyOn(Device.prototype, 'save').mockRejectedValueOnce(new Error('Simulated Mongoose Save Failure'));

      const res = await request(app)
        .post('/api/v1/device/location')
        .set('x-device-key', deviceApiKey)
        .send({
          device_id: testDeviceId,
          seq: 999,
          latitude: 28.6139,
          longitude: 77.209,
          speed_kmph: 15,
          gps_utc: new Date(Date.now() - 500).toISOString(),
          fix_valid: true,
        });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);

      // Verify that no location update was broadcast to subscribed clients
      expect(emitLocationSpy).not.toHaveBeenCalled();

      saveSpy.mockRestore();
      emitLocationSpy.mockRestore();
      emitStatusSpy.mockRestore();
    });
  });
});
