import { Server as SocketIOServer, Socket } from 'socket.io';
import { authService, AdminPayload } from '../auth/auth.service';
import { devicesService } from '../devices/devices.service';
import { logger } from '../../utils/logger';

interface AuthenticatedSocket extends Socket {
  data: {
    admin?: AdminPayload;
  };
}

export function setupSocketHandlers(io: SocketIOServer): void {
  // Authentication middleware for Socket.IO connections
  io.use((socket: AuthenticatedSocket, next) => {
    try {
      const authHeader = socket.handshake.headers.authorization;
      const token =
        socket.handshake.auth?.token ||
        (authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined) ||
        socket.handshake.query?.token;

      if (!token || typeof token !== 'string') {
        return next(new Error('Authentication token required'));
      }

      const decoded = authService.verifyToken(token);
      socket.data.admin = decoded;
      next();
    } catch (err: any) {
      logger.warn('Socket authentication failed:', { error: err.message });
      next(new Error('Invalid or expired authentication token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    const admin = socket.data.admin!;
    logger.info(`Socket connected for admin ${admin.email} (ID: ${admin.id}, Socket: ${socket.id})`);

    // Subscribe to a device's real-time updates
    socket.on('tracking:subscribe', async (payload: { deviceId?: string }) => {
      try {
        const rawDeviceId = payload?.deviceId;
        if (!rawDeviceId || typeof rawDeviceId !== 'string') {
          socket.emit('tracking:error', {
            message: 'deviceId is required to subscribe',
            code: 'INVALID_DEVICE_ID',
          });
          return;
        }

        const deviceId = rawDeviceId.toUpperCase();

        // Safe ownership check: ensures device belongs to this connected admin
        const device = await devicesService.getDevice(admin.id, deviceId);

        const room = `device:${deviceId}`;
        socket.join(room);

        logger.info(`Admin ${admin.email} subscribed to ${room}`);

        socket.emit('tracking:subscribed', {
          deviceId,
          status: device.status,
          batteryPercent: device.batteryPercent,
          latestLocation: device.latestLocation,
          lastSeenAt: device.lastSeenAt,
        });
      } catch (error: any) {
        logger.warn(`Failed subscription attempt by admin ${admin.email}:`, { error: error.message });
        socket.emit('tracking:error', {
          message: error.message || 'Unable to subscribe to device',
          code: error.code || 'SUBSCRIPTION_FORBIDDEN',
        });
      }
    });

    // Unsubscribe from a device's real-time updates
    socket.on('tracking:unsubscribe', (payload: { deviceId?: string }) => {
      try {
        const rawDeviceId = payload?.deviceId;
        if (!rawDeviceId || typeof rawDeviceId !== 'string') {
          return;
        }

        const deviceId = rawDeviceId.toUpperCase();
        const room = `device:${deviceId}`;
        socket.leave(room);

        logger.info(`Admin ${admin.email} unsubscribed from ${room}`);
        socket.emit('tracking:unsubscribed', { deviceId });
      } catch (error: any) {
        logger.error('Error during tracking:unsubscribe:', error);
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info(`Socket disconnected: ${socket.id} (${reason})`);
    });
  });
}
