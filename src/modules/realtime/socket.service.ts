import { Server as SocketIOServer } from 'socket.io';
import { logger } from '../../utils/logger';

export interface LocationBroadcast {
  deviceId: string;
  latitude: number;
  longitude: number;
  speed: number;
  timestamp: string;
  gpsFixed: boolean;
  receivedAt: string;
}

export interface DeviceStatusBroadcast {
  deviceId: string;
  status: 'online' | 'offline';
  batteryPercent?: number | null;
  lastSeenAt: string;
  gpsFixed?: boolean;
}

class SocketService {
  private io: SocketIOServer | null = null;

  public init(io: SocketIOServer): void {
    this.io = io;
    logger.info('Socket.IO service initialized');
  }

  public getIO(): SocketIOServer | null {
    return this.io;
  }

  public emitLocationUpdate(deviceId: string, data: LocationBroadcast): void {
    if (!this.io) {
      return;
    }
    const room = `device:${deviceId.toUpperCase()}`;
    this.io.to(room).emit('tracking:location', data);
    logger.debug(`Emitted tracking:location to room ${room}`, { deviceId });
  }

  public emitDeviceStatus(deviceId: string, data: DeviceStatusBroadcast): void {
    if (!this.io) {
      return;
    }
    const room = `device:${deviceId.toUpperCase()}`;
    this.io.to(room).emit('device:status', data);
    logger.debug(`Emitted device:status to room ${room}`, { deviceId });
  }
}

export const socketService = new SocketService();
