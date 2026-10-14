import { Device, IDevice } from './device.model';
import { LocationHistory } from '../locations/locationHistory.model';
import { RegisterDeviceInput, UpdateDeviceInput } from './devices.schema';
import { AppError } from '../../middleware/errorHandler.middleware';
import { generateDeviceApiKey, hashDeviceApiKey } from '../../utils/crypto';
import { env } from '../../config/env';

export interface FormattedDevice {
  id: string;
  deviceId: string;
  ownerAdminId: string;
  name: string;
  latestLocation?: {
    latitude: number;
    longitude: number;
    speed: number;
    timestamp: Date;
    gpsFixed: boolean;
  } | null;
  batteryPercent?: number | null;
  lastSeenAt?: Date | null;
  status: 'online' | 'offline';
  createdAt: Date;
  updatedAt: Date;
}

export class DevicesService {
  computeDeviceStatus(lastSeenAt?: Date | null): 'online' | 'offline' {
    if (!lastSeenAt) {
      return 'offline';
    }
    const timeDiffMs = Date.now() - new Date(lastSeenAt).getTime();
    const timeoutMs = env.DEVICE_OFFLINE_TIMEOUT_SECONDS * 1000;
    return timeDiffMs <= timeoutMs ? 'online' : 'offline';
  }

  formatDevice(device: IDevice): FormattedDevice {
    const computedStatus = this.computeDeviceStatus(device.lastSeenAt);

    return {
      id: device._id.toString(),
      deviceId: device.deviceId,
      ownerAdminId: device.ownerAdminId.toString(),
      name: device.name,
      latestLocation: device.latestLocation ? {
        latitude: device.latestLocation.latitude,
        longitude: device.latestLocation.longitude,
        speed: device.latestLocation.speed,
        timestamp: device.latestLocation.timestamp,
        gpsFixed: device.latestLocation.gpsFixed,
      } : null,
      batteryPercent: device.batteryPercent ?? null,
      lastSeenAt: device.lastSeenAt ?? null,
      status: computedStatus,
      createdAt: device.createdAt,
      updatedAt: device.updatedAt,
    };
  }

  async registerDevice(
    adminId: string,
    input: RegisterDeviceInput
  ): Promise<{ device: FormattedDevice; apiKey: string }> {
    const existing = await Device.findOne({ deviceId: input.deviceId });
    if (existing) {
      throw new AppError(
        `Device with ID '${input.deviceId}' is already registered`,
        409,
        'DEVICE_ALREADY_EXISTS'
      );
    }

    const plainApiKey = generateDeviceApiKey();
    const apiKeyHash = hashDeviceApiKey(plainApiKey);

    const device = await Device.create({
      deviceId: input.deviceId,
      ownerAdminId: adminId,
      name: input.name,
      apiKeyHash,
      status: 'offline',
    });

    return {
      device: this.formatDevice(device),
      apiKey: plainApiKey,
    };
  }

  async listDevices(adminId: string): Promise<FormattedDevice[]> {
    const devices = await Device.find({ ownerAdminId: adminId }).sort({ createdAt: -1 });
    return devices.map((d) => this.formatDevice(d));
  }

  async getDevice(adminId: string, rawDeviceId: string): Promise<FormattedDevice> {
    const deviceId = rawDeviceId.toUpperCase();
    const device = await Device.findOne({ deviceId });

    if (!device) {
      throw new AppError(`Device '${deviceId}' not found`, 404, 'DEVICE_NOT_FOUND');
    }

    if (device.ownerAdminId.toString() !== adminId) {
      throw new AppError('Access denied: You do not own this device', 403, 'FORBIDDEN');
    }

    return this.formatDevice(device);
  }

  async updateDevice(
    adminId: string,
    rawDeviceId: string,
    input: UpdateDeviceInput
  ): Promise<FormattedDevice> {
    const deviceId = rawDeviceId.toUpperCase();
    const device = await Device.findOne({ deviceId });

    if (!device) {
      throw new AppError(`Device '${deviceId}' not found`, 404, 'DEVICE_NOT_FOUND');
    }

    if (device.ownerAdminId.toString() !== adminId) {
      throw new AppError('Access denied: You do not own this device', 403, 'FORBIDDEN');
    }

    if (input.name) {
      device.name = input.name;
    }

    await device.save();
    return this.formatDevice(device);
  }

  async deleteDevice(adminId: string, rawDeviceId: string): Promise<void> {
    const deviceId = rawDeviceId.toUpperCase();
    const device = await Device.findOne({ deviceId });

    if (!device) {
      throw new AppError(`Device '${deviceId}' not found`, 404, 'DEVICE_NOT_FOUND');
    }

    if (device.ownerAdminId.toString() !== adminId) {
      throw new AppError('Access denied: You do not own this device', 403, 'FORBIDDEN');
    }

    await Device.deleteOne({ _id: device._id });
    // Also delete associated location history for clean cleanup
    await LocationHistory.deleteMany({ deviceId });
  }

  async rotateApiKey(
    adminId: string,
    rawDeviceId: string
  ): Promise<{ deviceId: string; apiKey: string }> {
    const deviceId = rawDeviceId.toUpperCase();
    const device = await Device.findOne({ deviceId });

    if (!device) {
      throw new AppError(`Device '${deviceId}' not found`, 404, 'DEVICE_NOT_FOUND');
    }

    if (device.ownerAdminId.toString() !== adminId) {
      throw new AppError('Access denied: You do not own this device', 403, 'FORBIDDEN');
    }

    const newApiKey = generateDeviceApiKey();
    device.apiKeyHash = hashDeviceApiKey(newApiKey);
    await device.save();

    return {
      deviceId: device.deviceId,
      apiKey: newApiKey,
    };
  }

  async getRawDeviceById(deviceId: string): Promise<IDevice | null> {
    return Device.findOne({ deviceId: deviceId.toUpperCase() });
  }
}

export const devicesService = new DevicesService();
