import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import { io as ClientIO, Socket as ClientSocket } from 'socket.io-client';
import { Server as SocketIOServer } from 'socket.io';
import request from 'supertest';
import { createApp } from '../src/app';
import { socketService } from '../src/modules/realtime/socket.service';
import { setupSocketHandlers } from '../src/modules/realtime/socket.handler';

describe('Socket.IO Live Tracking Module', () => {
  let server: http.Server;
  let serverPort: number;
  let adminToken1: string;
  let adminToken2: string;
  let deviceApiKey: string;
  const deviceId1 = 'REALTIME_TRUCK_1';

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
    // 1. Create Admin 1
    const res1 = await request(server).post('/api/v1/auth/register').send({
      name: 'Realtime Admin 1',
      email: 'admin1_rt@test.com',
      password: 'password123',
    });
    adminToken1 = res1.body.data.token;

    // 2. Create Admin 2
    const res2 = await request(server).post('/api/v1/auth/register').send({
      name: 'Realtime Admin 2',
      email: 'admin2_rt@test.com',
      password: 'password123',
    });
    adminToken2 = res2.body.data.token;

    // 3. Register device under Admin 1
    const devRes = await request(server)
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${adminToken1}`)
      .send({
        deviceId: deviceId1,
        name: 'Realtime Device 1',
      });
    deviceApiKey = devRes.body.data.apiKey;
  });

  it('should reject socket connection without authentication token', async () => {
    const client = ClientIO(`http://localhost:${serverPort}`, {
      transports: ['websocket'],
      autoConnect: false,
    });

    const errorPromise = new Promise<string>((resolve) => {
      client.on('connect_error', (err) => {
        resolve(err.message);
      });
    });

    client.connect();
    const errorMsg = await errorPromise;
    expect(errorMsg).toContain('Authentication token required');
    client.disconnect();
  });

  it('should allow socket connection with valid admin JWT', async () => {
    const client = ClientIO(`http://localhost:${serverPort}`, {
      auth: { token: adminToken1 },
      transports: ['websocket'],
      autoConnect: false,
    });

    const connectPromise = new Promise<boolean>((resolve) => {
      client.on('connect', () => {
        resolve(true);
      });
    });

    client.connect();
    const connected = await connectPromise;
    expect(connected).toBe(true);
    client.disconnect();
  });

  it('should allow admin to subscribe to their owned device', async () => {
    const client = ClientIO(`http://localhost:${serverPort}`, {
      auth: { token: adminToken1 },
      transports: ['websocket'],
    });

    const subscribePromise = new Promise<any>((resolve) => {
      client.on('tracking:subscribed', (data) => {
        resolve(data);
      });
      client.emit('tracking:subscribe', { deviceId: deviceId1 });
    });

    const subData = await subscribePromise;
    expect(subData.deviceId).toBe(deviceId1);
    expect(subData.status).toBe('offline');

    client.disconnect();
  });

  it('should deny subscription when admin tries to subscribe to a device owned by another admin', async () => {
    // Admin 2 connects
    const clientAdmin2 = ClientIO(`http://localhost:${serverPort}`, {
      auth: { token: adminToken2 },
      transports: ['websocket'],
    });

    const errorPromise = new Promise<any>((resolve) => {
      clientAdmin2.on('tracking:error', (err) => {
        resolve(err);
      });
      // Admin 2 tries to subscribe to Admin 1's device
      clientAdmin2.emit('tracking:subscribe', { deviceId: deviceId1 });
    });

    const errorData = await errorPromise;
    expect(errorData.code).toBe('FORBIDDEN');
    expect(errorData.message).toContain('Access denied');

    clientAdmin2.disconnect();
  });

  it('should emit live tracking:location and device:status events only to authorized subscribers', async () => {
    // Admin 1 connects and subscribes
    const clientSubscriber = ClientIO(`http://localhost:${serverPort}`, {
      auth: { token: adminToken1 },
      transports: ['websocket'],
    });

    // Admin 2 connects but is NOT subscribed to this device
    const clientUnsubscribed = ClientIO(`http://localhost:${serverPort}`, {
      auth: { token: adminToken2 },
      transports: ['websocket'],
    });

    let unsubscribedReceivedEvent = false;
    clientUnsubscribed.on('tracking:location', () => {
      unsubscribedReceivedEvent = true;
    });

    // Wait for subscription confirmation
    await new Promise<void>((resolve) => {
      clientSubscriber.on('tracking:subscribed', () => resolve());
      clientSubscriber.emit('tracking:subscribe', { deviceId: deviceId1 });
    });

    // Listen for live location and status events on the subscriber socket
    const locationPromise = new Promise<any>((resolve) => {
      clientSubscriber.on('tracking:location', (loc) => resolve(loc));
    });

    const statusPromise = new Promise<any>((resolve) => {
      clientSubscriber.on('device:status', (stat) => resolve(stat));
    });

    // Simulate device posting its coordinates
    const timestamp = new Date().toISOString();
    await request(server)
      .post('/api/v1/device/location')
      .set('x-device-key', deviceApiKey)
      .send({
        deviceId: deviceId1,
        timestamp,
        latitude: 19.076,
        longitude: 72.8777,
        speed: 70.0,
        gpsFixed: true,
        batteryPercent: 94,
      });

    const receivedLocation = await locationPromise;
    const receivedStatus = await statusPromise;

    expect(receivedLocation.deviceId).toBe(deviceId1);
    expect(receivedLocation.latitude).toBe(19.076);
    expect(receivedLocation.longitude).toBe(72.8777);
    expect(receivedLocation.speed).toBe(70.0);

    expect(receivedStatus.deviceId).toBe(deviceId1);
    expect(receivedStatus.status).toBe('online');
    expect(receivedStatus.batteryPercent).toBe(94);

    // Ensure non-subscribed client never received the location
    expect(unsubscribedReceivedEvent).toBe(false);

    clientSubscriber.disconnect();
    clientUnsubscribed.disconnect();
  });

  it('should handle repeated subscriptions to the same device idempotently', async () => {
    const client = ClientIO(`http://localhost:${serverPort}`, {
      auth: { token: adminToken1 },
      transports: ['websocket'],
    });

    let subscribedEventCount = 0;
    client.on('tracking:subscribed', (data) => {
      expect(data.deviceId).toBe(deviceId1);
      subscribedEventCount++;
    });

    // First subscription
    client.emit('tracking:subscribe', { deviceId: deviceId1 });
    await new Promise((r) => setTimeout(r, 100));

    // Duplicate subscription to the same room
    client.emit('tracking:subscribe', { deviceId: deviceId1 });
    await new Promise((r) => setTimeout(r, 100));

    expect(subscribedEventCount).toBe(2);
    client.disconnect();
  });

  it('should handle socket reconnects cleanly', async () => {
    const client = ClientIO(`http://localhost:${serverPort}`, {
      auth: { token: adminToken1 },
      transports: ['websocket'],
      autoConnect: false,
    });

    // First connection
    const connect1 = new Promise<boolean>((resolve) => {
      client.once('connect', () => resolve(true));
    });
    client.connect();
    expect(await connect1).toBe(true);

    // Disconnect
    client.disconnect();
    expect(client.connected).toBe(false);

    // Reconnect
    const connect2 = new Promise<boolean>((resolve) => {
      client.once('connect', () => resolve(true));
    });
    client.connect();
    expect(await connect2).toBe(true);

    client.disconnect();
  });

  it('should clean up socket subscriptions and state on disconnect', async () => {
    const client = ClientIO(`http://localhost:${serverPort}`, {
      auth: { token: adminToken1 },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => {
      client.on('tracking:subscribed', () => resolve());
      client.emit('tracking:subscribe', { deviceId: deviceId1 });
    });

    const disconnectPromise = new Promise<string>((resolve) => {
      client.on('disconnect', (reason) => resolve(reason));
    });

    client.disconnect();
    const reason = await disconnectPromise;
    expect(reason).toBe('io client disconnect');
    expect(client.connected).toBe(false);
  });
});
