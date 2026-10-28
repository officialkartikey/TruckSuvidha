import { randomUUID } from 'crypto';
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
    const inputTimestampMs = input.timestamp.getTime();

    // 1. Idempotency Check: check if this exact timestamp was already recorded for this device
    const existingHistory = await LocationHistory.findOne({
      deviceId,
      timestamp: input.timestamp,
    });

    if (existingHistory) {
      // Check if seq is identical (or not provided)
      const isSameSeq =
        input.seq === undefined ||
        input.seq === null ||
        existingHistory.seq === null ||
        existingHistory.seq === undefined ||
        existingHistory.seq === input.seq;

      if (isSameSeq) {
        logger.info(
          `Idempotent duplicate retry acknowledged for device ${deviceId} at ${input.timestamp.toISOString()}`
        );
        return {
          deviceId,
          gpsFixed: input.gpsFixed,
          receivedAt: existingHistory.receivedAt || receivedAt,
          latestLocationUpdated: false,
          historySaved: false,
          message: 'Duplicate telemetry retry acknowledged. Location already recorded.',
        };
      }
    }

    // 2. Sequence Number & Session Tracking
    let isNewSession = false;
    const currentLatestTimestamp = device.latestLocation?.timestamp
      ? new Date(device.latestLocation.timestamp).getTime()
      : null;

    if (input.seq !== undefined && input.seq !== null) {
      if (input.sessionId) {
        if (!device.sessionId || device.sessionId !== input.sessionId) {
          isNewSession = true;
          device.sessionId = input.sessionId;
          device.sessionStartTime = input.timestamp;
          device.lastSeq = input.seq;
          logger.info(
            `Device ${deviceId} started new session ${input.sessionId} at seq ${input.seq}`
          );
        }
      } else if (
        device.lastSeq !== null &&
        device.lastSeq !== undefined &&
        input.seq < device.lastSeq &&
        currentLatestTimestamp !== null &&
        inputTimestampMs >= currentLatestTimestamp
      ) {
        // Reboot / counter reset detected!
        // The sequence number decreased while time advanced or stayed current.
        isNewSession = true;
        device.sessionId = randomUUID();
        device.sessionStartTime = input.timestamp;
        device.lastSeq = input.seq;
        logger.info(
          `Device ${deviceId} reboot / counter reset detected (seq reset from ${device.lastSeq} to ${input.seq}). Started new tracking session.`
        );
      }

      if (!isNewSession) {
        // If seq equals lastSeq:
        if (device.lastSeq === input.seq) {
          // If the timestamp matches current latest location, it's an idempotent retry of latest location
          if (currentLatestTimestamp !== null && inputTimestampMs === currentLatestTimestamp) {
            logger.info(`Idempotent duplicate retry of latest location for device ${deviceId} (seq: ${input.seq})`);
            return {
              deviceId,
              gpsFixed: input.gpsFixed,
              receivedAt: device.lastSeenAt || receivedAt,
              latestLocationUpdated: false,
              historySaved: false,
              message: 'Duplicate telemetry retry acknowledged. Location already recorded.',
            };
          }

          // Otherwise, device reused the same sequence number for a different timestamp!
          throw new AppError(
            `Duplicate sequence number: seq ${input.seq} has already been processed for device ${deviceId}`,
            409,
            'DUPLICATE_SEQUENCE_NUMBER',
            [{ field: 'seq', message: `Sequence number ${input.seq} already processed` }]
          );
        }

        // Query if this sequence number was already recorded within the active session
        const historyQuery: Record<string, unknown> = {
          deviceId,
          seq: input.seq,
        };
        if (device.sessionStartTime) {
          historyQuery.timestamp = { $gte: device.sessionStartTime };
        }
        if (device.sessionId) {
          historyQuery.sessionId = device.sessionId;
        }

        const existingSeq = await LocationHistory.findOne(historyQuery);
        if (existingSeq) {
          if (existingSeq.timestamp.getTime() === inputTimestampMs) {
            // Idempotent retry of a previously recorded point
            return {
              deviceId,
              gpsFixed: input.gpsFixed,
              receivedAt: existingSeq.receivedAt || receivedAt,
              latestLocationUpdated: false,
              historySaved: false,
              message: 'Duplicate telemetry retry acknowledged. Location already recorded.',
            };
          }

          // Duplicate sequence number used for a different timestamp in this session
          throw new AppError(
            `Duplicate sequence number: seq ${input.seq} has already been processed for device ${deviceId}`,
            409,
            'DUPLICATE_SEQUENCE_NUMBER',
            [{ field: 'seq', message: `Sequence number ${input.seq} already processed` }]
          );
        }
      }
    }

    // Always update lastSeenAt for authenticated device; update battery if provided
    device.lastSeenAt = receivedAt;
    if (input.batteryPercent !== undefined && input.batteryPercent !== null) {
      device.batteryPercent = input.batteryPercent;
    }
    device.status = 'online';

    // Case 1: gpsFixed is false — accept status update without overwriting valid coordinates
    if (!input.gpsFixed) {
      if (input.seq !== undefined && input.seq !== null) {
        if (device.lastSeq === null || device.lastSeq === undefined || isNewSession) {
          device.lastSeq = input.seq;
        } else {
          device.lastSeq = Math.max(device.lastSeq, input.seq);
        }
      }

      await device.save();
      logger.info(`Received non-GPS status update for device ${deviceId}`, {
        batteryPercent: device.batteryPercent,
        receivedAt,
      });

      // Broadcast device status update ONLY AFTER DB save succeeds
      socketService.emitDeviceStatus(deviceId, {
        deviceId,
        status: 'online',
        batteryPercent: device.batteryPercent ?? undefined,
        lastSeenAt: receivedAt.toISOString(),
        gpsFixed: false,
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

    if (!existingHistory) {
      try {
        await LocationHistory.create({
          deviceId,
          seq: input.seq ?? null,
          sessionId: device.sessionId ?? null,
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
    } else {
      logger.info(
        `Buffered/delayed location for ${deviceId} saved to history but did not overwrite newer latest location`
      );
    }

    // Update lastSeq monotonically for newer/equal locations or new sessions
    if (input.seq !== undefined && input.seq !== null) {
      if (device.lastSeq === null || device.lastSeq === undefined || isNewSession) {
        device.lastSeq = input.seq;
      } else if (isNewerOrEqual) {
        device.lastSeq = Math.max(device.lastSeq, input.seq);
      }
    }

    // Persist device state in MongoDB
    await device.save();

    // Broadcast Socket.IO status and location updates ONLY AFTER DB persistence succeeds
    socketService.emitDeviceStatus(deviceId, {
      deviceId,
      status: 'online',
      batteryPercent: device.batteryPercent ?? undefined,
      lastSeenAt: receivedAt.toISOString(),
      gpsFixed: true,
    });

    if (latestLocationUpdated) {
      socketService.emitLocationUpdate(deviceId, {
        deviceId,
        latitude: input.latitude,
        longitude: input.longitude,
        speed: input.speed,
        timestamp: input.timestamp.toISOString(),
        gpsFixed: true,
        receivedAt: receivedAt.toISOString(),
      });
    }

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
