import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import { io as ClientIO, Socket as ClientSocket } from 'socket.io-client';
import { Server as SocketIOServer } from 'socket.io';
import request from 'supertest';
import { createApp } from '../src/app';
import { socketService } from '../src/modules/realtime/socket.service';
import { setupSocketHandlers } from '../src/modules/realtime/socket.handler';
import { Device } from '../src/modules/devices/device.model';
import { LocationHistory } from '../src/modules/locations/locationHistory.model';

describe('SMS-Based Location Ingestion Module', () => {
  let server: http.Server;
  let serverPort: number;
  let adminToken1: string;
  let adminToken2: string;
  let deviceApiKey1: string;

  const deviceId1 = 'TRUCK001';
  const deviceId2 = 'TRUCK002';
  const vehicleSimNumber1 = '+919876543210';
  const vehicleSimNumber2 = '+919123456789';

  beforeAll(async () => {
    const app = createApp();
    server = http.createServer(app);
    const io = new SocketIOServer(server, { cors: { origin: '*' } });
    socketService.init(io);
    setupSocketHandlers(io);

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        serverPort = address.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  beforeEach(async () => {
    // 1. Register Admin 1
    const res1 = await request(server).post('/api/v1/auth/register').send({
      name: 'Fleet Admin One',
      email: 'admin1_sms@trucksuvidha.com',
      password: 'password123',
    });
    adminToken1 = res1.body.data.token;

    // 2. Register Admin 2
    const res2 = await request(server).post('/api/v1/auth/register').send({
      name: 'Fleet Admin Two',
      email: 'admin2_sms@trucksuvidha.com',
      password: 'password123',
    });
    adminToken2 = res2.body.data.token;

    // 3. Register Device 1 under Admin 1 with SMS enabled and registered SIM number
    const devRes1 = await request(server)
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        deviceId: deviceId1,
        name: 'Refrigerated Truck #1',
        smsSenderNumber: vehicleSimNumber1,
        smsEnabled: true,
      });
    deviceApiKey1 = devRes1.body.data.apiKey;

    // 4. Register Device 2 under Admin 2
    await request(server)
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${adminToken2}`)
      .send({
        deviceId: deviceId2,
        name: 'Dry Cargo Truck #2',
        smsSenderNumber: vehicleSimNumber2,
        smsEnabled: true,
      });
  });

  // Test 1: Valid SMS location
  it('1. should successfully ingest a valid SMS location and update device state', async () => {
    const timestamp = new Date(Date.now() - 5000).toISOString();
    const res = await request(server)
      .post('/api/v1/sms/location')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        deviceId: deviceId1,
        sequence: 1025,
        latitude: 28.677307,
        longitude: 77.499718,
        accuracy: 550,
        source: 'GNSS',
        timestamp,
        senderNumber: vehicleSimNumber1,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.deviceId).toBe(deviceId1);
    expect(res.body.data.sequence).toBe(1025);
    expect(res.body.data.latestLocationUpdated).toBe(true);
    expect(res.body.data.historySaved).toBe(true);
  });

  // Test 2: Invalid SMS payload (missing required fields)
  it('2. should reject invalid SMS payload when required fields are missing', async () => {
    const res = await request(server)
      .post('/api/v1/sms/location')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        deviceId: deviceId1,
        // sequence missing
        latitude: 28.677307,
        longitude: 77.499718,
        senderNumber: vehicleSimNumber1,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('SMS_LOCATION_VALIDATION_FAILED');
  });

  // Test 3: Invalid latitude and longitude
  it('3. should reject out-of-range coordinates (latitude > 90 or longitude > 180)', async () => {
    const res = await request(server)
      .post('/api/v1/sms/location')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        deviceId: deviceId1,
        sequence: 1026,
        latitude: 95.0, // Invalid latitude > 90
        longitude: 77.499718,
        accuracy: 50,
        source: 'GNSS',
        timestamp: new Date().toISOString(),
        senderNumber: vehicleSimNumber1,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('SMS_LOCATION_VALIDATION_FAILED');
  });

  // Test 4: Unknown device
  it('4. should return 404 when device is not found in the database', async () => {
    const res = await request(server)
      .post('/api/v1/sms/location')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        deviceId: 'NON_EXISTENT_TRUCK',
        sequence: 100,
        latitude: 28.677307,
        longitude: 77.499718,
        accuracy: 10,
        source: 'GNSS',
        timestamp: new Date().toISOString(),
        senderNumber: vehicleSimNumber1,
      });

    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('DEVICE_NOT_FOUND');
  });

  // Test 5: Unauthorized admin (missing or invalid JWT)
  it('5. should reject requests without a valid admin JWT Bearer token', async () => {
    // No Authorization header
    const res1 = await request(server).post('/api/v1/sms/location').send({
      deviceId: deviceId1,
      sequence: 100,
      latitude: 28.677307,
      longitude: 77.499718,
      senderNumber: vehicleSimNumber1,
      timestamp: new Date().toISOString(),
    });

    expect(res1.status).toBe(401);
    expect(res1.body.error?.code).toBe('UNAUTHORIZED');

    // Invalid JWT Bearer token
    const res2 = await request(server)
      .post('/api/v1/sms/location')
      .set('Authorization', 'Bearer invalid_admin_jwt_token')
      .send({
        deviceId: deviceId1,
        sequence: 100,
        latitude: 28.677307,
        longitude: 77.499718,
        senderNumber: vehicleSimNumber1,
        timestamp: new Date().toISOString(),
      });

    expect(res2.status).toBe(401);
    expect(res2.body.error?.code).toBe('INVALID_TOKEN');
  });

  // Test 6: Admin accessing another admin's device
  it("6. should reject when an admin attempts to ingest SMS for another admin's device (ownership enforcement)", async () => {
    // Admin 2 tries to submit SMS telemetry for Admin 1's deviceId1
    const res = await request(server)
      .post('/api/v1/sms/location')
      .set('Authorization', `Bearer ${adminToken2}`)
      .send({
        deviceId: deviceId1,
        sequence: 1030,
        latitude: 28.677307,
        longitude: 77.499718,
        accuracy: 20,
        source: 'GNSS',
        timestamp: new Date().toISOString(),
        senderNumber: vehicleSimNumber1,
      });

    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });

  // Test 7: Unregistered sender number
  it('7. should reject SMS location when sender phone number does not match registered vehicle SIM number', async () => {
    const res = await request(server)
      .post('/api/v1/sms/location')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        deviceId: deviceId1,
        sequence: 1031,
        latitude: 28.677307,
        longitude: 77.499718,
        accuracy: 20,
        source: 'GNSS',
        timestamp: new Date().toISOString(),
        senderNumber: '+919999999999', // Unknown/unregistered number
      });

    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('INVALID_SENDER_NUMBER');
  });

  // Test 8: Duplicate sequence number
  it('8. should reject duplicate sequence numbers used for different timestamps with 409 Conflict', async () => {
    const time1 = new Date(Date.now() - 10000).toISOString();
    const time2 = new Date(Date.now() - 5000).toISOString();

    // First SMS with sequence 1050
    const res1 = await request(server)
      .post('/api/v1/sms/location')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        deviceId: deviceId1,
        sequence: 1050,
        latitude: 28.677307,
        longitude: 77.499718,
        accuracy: 50,
        source: 'GNSS',
        timestamp: time1,
        senderNumber: vehicleSimNumber1,
      });
    expect(res1.status).toBe(200);

    // Replay of sequence 1050 with a different timestamp
    const res2 = await request(server)
      .post('/api/v1/sms/location')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        deviceId: deviceId1,
        sequence: 1050,
        latitude: 28.677310,
        longitude: 77.499720,
        accuracy: 50,
        source: 'GNSS',
        timestamp: time2,
        senderNumber: vehicleSimNumber1,
      });

    expect(res2.status).toBe(409);
    expect(res2.body.error?.code).toBe('DUPLICATE_SEQUENCE_NUMBER');
  });

  // Test 9: Out-of-order SMS
  it('9. should safely persist out-of-order delayed SMS in history without overwriting newer latestLocation', async () => {
    const timeNewer = new Date(Date.now() - 5000);
    const timeOlder = new Date(Date.now() - 30000); // 30 seconds earlier

    // Newer SMS arrives first (seq 1060)
    const res1 = await request(server)
      .post('/api/v1/sms/location')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        deviceId: deviceId1,
        sequence: 1060,
        latitude: 28.677307,
        longitude: 77.499718,
        accuracy: 25,
        source: 'GNSS',
        timestamp: timeNewer.toISOString(),
        senderNumber: vehicleSimNumber1,
      });
    expect(res1.status).toBe(200);
    expect(res1.body.data.latestLocationUpdated).toBe(true);

    // Delayed SMS arrives out-of-order (seq 1059 with older timeOlder)
    const res2 = await request(server)
      .post('/api/v1/sms/location')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        deviceId: deviceId1,
        sequence: 1059,
        latitude: 28.600000,
        longitude: 77.400000,
        accuracy: 30,
        source: 'GNSS',
        timestamp: timeOlder.toISOString(),
        senderNumber: vehicleSimNumber1,
      });

    expect(res2.status).toBe(200);
    expect(res2.body.data.historySaved).toBe(true);
    expect(res2.body.data.latestLocationUpdated).toBe(false);

    // Verify Device.latestLocation still holds the newer coordinates (28.677307)
    const deviceInDb = await Device.findOne({ deviceId: deviceId1 });
    expect(deviceInDb?.latestLocation?.latitude).toBe(28.677307);
    expect(deviceInDb?.lastSmsSequence).toBe(1060);
  });

  // Test 10: Expired or delayed SMS
  it('10. should reject stale/expired SMS with timestamp exceeding MAX_GPS_AGE_HOURS', async () => {
    // 25 hours in the past (exceeds default MAX_GPS_AGE_HOURS = 24)
    const staleTime = new Date(Date.now() - 25 * 3600 * 1000).toISOString();

    const res = await request(server)
      .post('/api/v1/sms/location')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        deviceId: deviceId1,
        sequence: 1070,
        latitude: 28.677307,
        longitude: 77.499718,
        accuracy: 50,
        source: 'GNSS',
        timestamp: staleTime,
        senderNumber: vehicleSimNumber1,
      });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('SMS_LOCATION_VALIDATION_FAILED');
  });

  // Test 11: Duplicate request retry
  it('11. should acknowledge duplicate request retry idempotently with 200 OK', async () => {
    const timestamp = new Date(Date.now() - 8000).toISOString();
    const payload = {
      deviceId: deviceId1,
      sequence: 1080,
      latitude: 28.677307,
      longitude: 77.499718,
      accuracy: 100,
      source: 'GNSS',
      timestamp,
      senderNumber: vehicleSimNumber1,
    };

    // First attempt
    const res1 = await request(server)
      .post('/api/v1/sms/location')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send(payload);
    expect(res1.status).toBe(200);
    expect(res1.body.data.latestLocationUpdated).toBe(true);
    expect(res1.body.data.historySaved).toBe(true);

    // Network retry of the exact same message
    const res2 = await request(server)
      .post('/api/v1/sms/location')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send(payload);

    expect(res2.status).toBe(200);
    expect(res2.body.success).toBe(true);
    expect(res2.body.data.latestLocationUpdated).toBe(false);
    expect(res2.body.data.historySaved).toBe(false);
    expect(res2.body.data.message).toContain('Duplicate SMS location retry acknowledged');
  });

  // Test 12: LocationHistory persistence
  it('12. should correctly persist SMS location record in LocationHistory collection', async () => {
    const timestamp = new Date(Date.now() - 2000);
    const res = await request(server)
      .post('/api/v1/sms/location')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        deviceId: deviceId1,
        sequence: 1090,
        latitude: 28.677307,
        longitude: 77.499718,
        accuracy: 450,
        source: 'CELLULAR',
        timestamp: timestamp.toISOString(),
        senderNumber: vehicleSimNumber1,
      });

    expect(res.status).toBe(200);

    const history = await LocationHistory.findOne({
      deviceId: deviceId1,
      seq: 1090,
    });

    expect(history).toBeDefined();
    expect(history?.latitude).toBe(28.677307);
    expect(history?.longitude).toBe(77.499718);
    expect(history?.accuracy).toBe(450);
    expect(history?.source).toBe('CELLULAR');
    expect(history?.timestamp.getTime()).toBe(timestamp.getTime());
  });

  // Test 13: Device.latestLocation update
  it('13. should update Device.latestLocation, lastSmsSequence, and lastSmsReceivedAt in MongoDB', async () => {
    const timestamp = new Date(Date.now() - 1000);
    const res = await request(server)
      .post('/api/v1/sms/location')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        deviceId: deviceId1,
        sequence: 1100,
        latitude: 28.685,
        longitude: 77.51,
        accuracy: 200,
        source: 'GNSS',
        timestamp: timestamp.toISOString(),
        senderNumber: vehicleSimNumber1,
      });

    expect(res.status).toBe(200);

    const device = await Device.findOne({ deviceId: deviceId1 });
    expect(device).toBeDefined();
    expect(device?.latestLocation?.latitude).toBe(28.685);
    expect(device?.latestLocation?.longitude).toBe(77.51);
    expect(device?.latestLocation?.accuracy).toBe(200);
    expect(device?.latestLocation?.source).toBe('GNSS');
    expect(device?.lastSmsSequence).toBe(1100);
    expect(device?.lastSmsReceivedAt).toBeDefined();
  });

  // Test 14: Socket.IO broadcast
  it('14. should broadcast device:location:update and tracking:location events via Socket.IO to subscribed admin', async () => {
    const client = ClientIO(`http://localhost:${serverPort}`, {
      auth: { token: adminToken1 },
      transports: ['websocket'],
    });

    // Wait for subscription confirmation
    await new Promise<void>((resolve) => {
      client.on('tracking:subscribed', () => resolve());
      client.emit('tracking:subscribe', { deviceId: deviceId1 });
    });

    // Listen for both events
    const locationUpdatePromise = new Promise<any>((resolve) => {
      client.on('device:location:update', (data) => resolve(data));
    });

    const trackingLocationPromise = new Promise<any>((resolve) => {
      client.on('tracking:location', (data) => resolve(data));
    });

    const timestamp = new Date(Date.now() - 2000).toISOString();
    await request(server)
      .post('/api/v1/sms/location')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        deviceId: deviceId1,
        sequence: 1110,
        latitude: 28.6999,
        longitude: 77.5222,
        accuracy: 350,
        source: 'GNSS',
        timestamp,
        senderNumber: vehicleSimNumber1,
      });

    const locationUpdate = await locationUpdatePromise;
    const trackingLocation = await trackingLocationPromise;

    expect(locationUpdate.deviceId).toBe(deviceId1);
    expect(locationUpdate.latitude).toBe(28.6999);
    expect(locationUpdate.longitude).toBe(77.5222);
    expect(locationUpdate.accuracy).toBe(350);
    expect(locationUpdate.source).toBe('GNSS');

    expect(trackingLocation.deviceId).toBe(deviceId1);
    expect(trackingLocation.latitude).toBe(28.6999);

    client.disconnect();
  });

  // Test 15: Existing ESP32 API-key location ingestion still works
  it('15. should ensure existing direct HTTP ESP32 API-key location ingestion remains fully operational', async () => {
    const timestamp = new Date(Date.now() - 1000).toISOString();
    const res = await request(server)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey1)
      .send({
        deviceId: deviceId1,
        timestamp,
        latitude: 28.7100,
        longitude: 77.5300,
        speed: 55.0,
        gpsFixed: true,
        batteryPercent: 88,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.latestLocationUpdated).toBe(true);

    const device = await Device.findOne({ deviceId: deviceId1 });
    expect(device?.latestLocation?.latitude).toBe(28.7100);
    expect(device?.batteryPercent).toBe(88);
  });

  // Test 16: Existing device registration and key rotation still work
  it('16. should verify existing device registration, key rotation, and retrieval still work seamlessly', async () => {
    // Register new device
    const regRes = await request(server)
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        deviceId: 'TRUCK_COMPAT_TEST',
        name: 'Compatibility Truck',
        smsSenderNumber: '+919811112222',
        smsEnabled: true,
      });

    expect(regRes.status).toBe(201);
    expect(regRes.body.data.device.deviceId).toBe('TRUCK_COMPAT_TEST');
    expect(regRes.body.data.device.smsSenderNumber).toBe('+919811112222');
    expect(regRes.body.data.device.smsEnabled).toBe(true);

    const oldApiKey = regRes.body.data.apiKey;

    // Rotate API Key
    const rotRes = await request(server)
      .post('/api/v1/devices/TRUCK_COMPAT_TEST/rotate-key')
      .set('Authorization', `Bearer ${adminToken1}`);

    expect(rotRes.status).toBe(200);
    expect(rotRes.body.data.apiKey).toBeDefined();
    expect(rotRes.body.data.apiKey).not.toBe(oldApiKey);
    expect(rotRes.body.data.apiKey.startsWith('trk_')).toBe(true);
  });

  // Additional Feature Test: Support raw SMS text payload in body
  it('17. should support compact rawMessage string parsed automatically by backend', async () => {
    const currentEpochSec = Math.floor(Date.now() / 1000) - 10;
    const rawSms = `DEVICE=TRUCK001;SEQ=1200;LAT=28.677307;LON=77.499718;ACC=550;SRC=GNSS;TIME=${currentEpochSec}`;
    const res = await request(server)
      .post('/api/v1/sms/location')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        rawMessage: rawSms,
        senderNumber: vehicleSimNumber1,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.deviceId).toBe(deviceId1);
    expect(res.body.data.sequence).toBe(1200);
    expect(res.body.data.latestLocationUpdated).toBe(true);
  });

  // Additional Feature Test: SMS tracking disabled rejected
  it('18. should reject SMS location when smsEnabled is false on the device', async () => {
    // Disable SMS on device 1
    await request(server)
      .patch(`/api/v1/devices/${deviceId1}`)
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({ smsEnabled: false });

    const res = await request(server)
      .post('/api/v1/sms/location')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        deviceId: deviceId1,
        sequence: 1250,
        latitude: 28.677307,
        longitude: 77.499718,
        accuracy: 100,
        source: 'GNSS',
        timestamp: new Date().toISOString(),
        senderNumber: vehicleSimNumber1,
      });

    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('SMS_TRACKING_DISABLED');
  });
});
