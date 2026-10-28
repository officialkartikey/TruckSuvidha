import { LocationHistory, ILocationHistory } from './locationHistory.model';
import { IDevice, Device } from '../devices/device.model';
import { LocationIngestionInput, LocationHistoryQueryInput } from './locations.schema';
import { devicesService } from '../devices/devices.service';
import { socketService } from '../realtime/socket.service';
import { logger } from '../../utils/logger';
import { AppError } from '../../middleware/errorHandler.middleware';

export interface IngestionResult {
  deviceId: string;
  gpsFixed: boolean;
  receivedAt: Date;
  latestLocationUpdated: boolean;
  historySaved: boolean;
  message: string;
}

export class LocationsService {
  async processLocation(input: LocationIngestionInput, device: IDevice): Promise<IngestionResult> {
    const receivedAt = new Date();
    const deviceId = device.deviceId;

    // Sequence number deduplication check
    if (input.seq !== undefined && input.seq !== null) {
      if (device.lastSeq === input.seq) {
        throw new AppError(
          `Duplicate sequence number: seq ${input.seq} has already been processed for device ${deviceId}`,
          409,
          'DUPLICATE_SEQUENCE_NUMBER',
          [{ field: 'seq', message: `Sequence number ${input.seq} already processed` }]
        );
      }
      const existingSeq = await LocationHistory.findOne({
        deviceId,
        seq: input.seq,
      });
      if (existingSeq) {
        throw new AppError(
          `Duplicate sequence number: seq ${input.seq} has already been processed for device ${deviceId}`,
          409,
          'DUPLICATE_SEQUENCE_NUMBER',
          [{ field: 'seq', message: `Sequence number ${input.seq} already processed` }]
        );
      }
      device.lastSeq = input.seq;
    }

    // Always update lastSeenAt for authenticated device; update battery if provided
    device.lastSeenAt = receivedAt;
    if (input.batteryPercent !== undefined && input.batteryPercent !== null) {
      device.batteryPercent = input.batteryPercent;
    }
    device.status = 'online';

    // Broadcast device status update to authorized live tracking subscribers
    socketService.emitDeviceStatus(deviceId, {
      deviceId,
      status: 'online',
      batteryPercent: device.batteryPercent ?? undefined,
      lastSeenAt: receivedAt.toISOString(),
      gpsFixed: input.gpsFixed,
    });

    // Case 1: gpsFixed is false — accept status update without overwriting valid coordinates
    if (!input.gpsFixed) {
      await device.save();
      logger.info(`Received non-GPS status update for device ${deviceId}`, {
        batteryPercent: device.batteryPercent,
        receivedAt,
      });

      return {
        deviceId,
        gpsFixed: false,
        receivedAt,
        latestLocationUpdated: false,
        historySaved: false,
        message: 'Status update recorded without GPS fix. Existing coordinates preserved.',
      };
    }

    // Case 2: gpsFixed is true — validate, deduplicate, and process GPS fix
    let historySaved = false;

    // Deduplication check: check if a record with the exact deviceId and timestamp already exists
    const existingHistory = await LocationHistory.findOne({
      deviceId,
      timestamp: input.timestamp,
    });

    if (!existingHistory) {
      try {
        await LocationHistory.create({
          deviceId,
          seq: input.seq ?? null,
          latitude: input.latitude,
          longitude: input.longitude,
          speed: input.speed,
          timestamp: input.timestamp,
          receivedAt,
        });
        historySaved = true;
      } catch (err: any) {
        // In case of a concurrent race condition hitting the unique index
        if (err.code === 11000) {
          logger.warn(`Duplicate location skipped for ${deviceId} at ${input.timestamp.toISOString()}`);
          historySaved = false;
        } else {
          throw err;
        }
      }
    } else {
      logger.debug(`Duplicate location event ignored for ${deviceId} at ${input.timestamp.toISOString()}`);
    }

    // Determine whether this location should update latestLocation
    // Rule: Prevent older or out-of-order timestamps from overwriting newer latest locations
    let latestLocationUpdated = false;
    const currentLatest = device.latestLocation;

    const isNewerOrEqual =
      !currentLatest ||
      !currentLatest.timestamp ||
      input.timestamp.getTime() >= new Date(currentLatest.timestamp).getTime();

    if (isNewerOrEqual) {
      device.latestLocation = {
        latitude: input.latitude,
        longitude: input.longitude,
        speed: input.speed,
        timestamp: input.timestamp,
        gpsFixed: true,
      };
      latestLocationUpdated = true;

      // Broadcast real-time location update to authorized room subscribers
      socketService.emitLocationUpdate(deviceId, {
        deviceId,
        latitude: input.latitude,
        longitude: input.longitude,
        speed: input.speed,
        timestamp: input.timestamp.toISOString(),
        gpsFixed: true,
        receivedAt: receivedAt.toISOString(),
      });
    } else {
      logger.info(
        `Buffered/delayed location for ${deviceId} saved to history but did not overwrite newer latest location`
      );
    }

    await device.save();

    return {
      deviceId,
      gpsFixed: true,
      receivedAt,
      latestLocationUpdated,
      historySaved,
      message: latestLocationUpdated
        ? 'Location updated and stored successfully'
        : 'Buffered historical location stored. Newer latest location preserved.',
    };
  }

  async getLocationHistory(
    adminId: string,
    rawDeviceId: string,
    query: LocationHistoryQueryInput
  ): Promise<ILocationHistory[]> {
    const deviceId = rawDeviceId.toUpperCase();

    // Verify admin owns this device before exposing location history
    await devicesService.getDevice(adminId, deviceId);

    const filter: Record<string, unknown> = { deviceId };

    if (query.from || query.to) {
      const timeFilter: Record<string, Date> = {};
      if (query.from) timeFilter.$gte = query.from;
      if (query.to) timeFilter.$lte = query.to;
      filter.timestamp = timeFilter;
    }

    return LocationHistory.find(filter)
      .sort({ timestamp: -1 })
      .limit(query.limit || 50)
      .lean();
  }
}

export const locationsService = new LocationsService();
