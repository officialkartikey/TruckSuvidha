import { Device, IDevice } from '../devices/device.model';
import { LocationHistory } from '../locations/locationHistory.model';
import { SmsLocationIngestionInput, normalizePhoneNumber } from './sms.schema';
import { devicesService } from '../devices/devices.service';
import { socketService } from '../realtime/socket.service';
import { logger } from '../../utils/logger';
import { AppError } from '../../middleware/errorHandler.middleware';
import { env } from '../../config/env';

export interface SmsIngestionResult {
  deviceId: string;
  sequence: number;
  receivedAt: Date;
  latestLocationUpdated: boolean;
  historySaved: boolean;
  source: string;
  accuracy: number;
  message: string;
}

export class SmsLocationService {
  async processSmsLocation(adminId: string, input: SmsLocationIngestionInput): Promise<SmsIngestionResult> {
    const receivedAt = new Date();
    const deviceId = input.deviceId.toUpperCase();
    const inputTimestampMs = input.timestamp.getTime();

    // 1. Verify Device Existence
    const device = await Device.findOne({ deviceId });
    if (!device) {
      throw new AppError(`Device '${deviceId}' not found`, 404, 'DEVICE_NOT_FOUND');
    }

    // 2. Verify Admin Ownership
    if (device.ownerAdminId.toString() !== adminId) {
      throw new AppError('Access denied: You do not own this device', 403, 'FORBIDDEN');
    }

    // 3. Verify SMS Tracking is Enabled
    if (!device.smsEnabled) {
      throw new AppError(
        `SMS tracking is disabled for device '${deviceId}'. Enable SMS tracking in device settings.`,
        403,
        'SMS_TRACKING_DISABLED'
      );
    }

    // 4. Verify Registered Vehicle Sender Number
    if (!device.smsSenderNumber) {
      throw new AppError(
        `No registered vehicle SIM number configured for device '${deviceId}'.`,
        403,
        'SENDER_NUMBER_NOT_CONFIGURED'
      );
    }

    const normalizedInputSender = normalizePhoneNumber(input.senderNumber);
    const normalizedDeviceSender = normalizePhoneNumber(device.smsSenderNumber);

    if (normalizedInputSender !== normalizedDeviceSender) {
      logger.warn(
        `SMS sender number verification failed for device ${deviceId}: received '${input.senderNumber}' (normalized: '${normalizedInputSender}'), expected '${device.smsSenderNumber}' (normalized: '${normalizedDeviceSender}')`
      );
      throw new AppError(
        `Unauthorized sender phone number for device '${deviceId}'. Expected '${device.smsSenderNumber}'.`,
        403,
        'INVALID_SENDER_NUMBER'
      );
    }

    // 5. Idempotency Check: check if this exact timestamp was already recorded for this device
    const existingHistory = await LocationHistory.findOne({
      deviceId,
      timestamp: input.timestamp,
    });

    if (existingHistory) {
      const isSameSeq =
        input.sequence === undefined ||
        input.sequence === null ||
        existingHistory.seq === null ||
        existingHistory.seq === undefined ||
        existingHistory.seq === input.sequence;

      if (isSameSeq) {
        logger.info(
          `Idempotent duplicate SMS retry acknowledged for device ${deviceId} at ${input.timestamp.toISOString()}`
        );
        return {
          deviceId,
          sequence: input.sequence,
          receivedAt: existingHistory.receivedAt || receivedAt,
          latestLocationUpdated: false,
          historySaved: false,
          source: input.source,
          accuracy: input.accuracy,
          message: 'Duplicate SMS location retry acknowledged. Location already recorded.',
        };
      }
    }

    // 6. Sequence Number & Replay / Duplicate Checks
    const currentLatestTimestamp = device.latestLocation?.timestamp
      ? new Date(device.latestLocation.timestamp).getTime()
      : null;

    let isNewSession = false;

    if (
      device.lastSmsSequence !== null &&
      device.lastSmsSequence !== undefined &&
      input.sequence < device.lastSmsSequence &&
      currentLatestTimestamp !== null &&
      inputTimestampMs >= currentLatestTimestamp
    ) {
      // Sequence counter reset / device reboot detected (timestamp advanced but seq decreased)
      isNewSession = true;
      logger.info(
        `Device ${deviceId} counter reset detected for SMS tracking (seq reset from ${device.lastSmsSequence} to ${input.sequence})`
      );
    }

    if (!isNewSession && device.lastSmsSequence !== null && device.lastSmsSequence !== undefined) {
      if (device.lastSmsSequence === input.sequence) {
        // If timestamp matches current latest location, it's an idempotent retry
        if (currentLatestTimestamp !== null && inputTimestampMs === currentLatestTimestamp) {
          logger.info(`Idempotent duplicate retry of latest SMS location for device ${deviceId} (seq: ${input.sequence})`);
          return {
            deviceId,
            sequence: input.sequence,
            receivedAt: device.lastSmsReceivedAt || receivedAt,
            latestLocationUpdated: false,
            historySaved: false,
            source: input.source,
            accuracy: input.accuracy,
            message: 'Duplicate SMS location retry acknowledged. Location already recorded.',
          };
        }

        // Duplicate sequence number reused for a different timestamp!
        throw new AppError(
          `Duplicate sequence number: sequence ${input.sequence} has already been processed for device ${deviceId}`,
          409,
          'DUPLICATE_SEQUENCE_NUMBER',
          [{ field: 'sequence', message: `Sequence number ${input.sequence} already processed` }]
        );
      }

      // Check if sequence number was already recorded in history
      const existingSeq = await LocationHistory.findOne({
        deviceId,
        seq: input.sequence,
      });

      if (existingSeq) {
        if (existingSeq.timestamp.getTime() === inputTimestampMs) {
          return {
            deviceId,
            sequence: input.sequence,
            receivedAt: existingSeq.receivedAt || receivedAt,
            latestLocationUpdated: false,
            historySaved: false,
            source: input.source,
            accuracy: input.accuracy,
            message: 'Duplicate SMS location retry acknowledged. Location already recorded.',
          };
        }

        throw new AppError(
          `Duplicate sequence number: sequence ${input.sequence} has already been processed for device ${deviceId}`,
          409,
          'DUPLICATE_SEQUENCE_NUMBER',
          [{ field: 'sequence', message: `Sequence number ${input.sequence} already processed` }]
        );
      }
    }

    // 7. Save Location History (Atomic / Idempotent against race conditions)
    let historySaved = false;
    if (!existingHistory) {
      try {
        await LocationHistory.create({
          deviceId,
          seq: input.sequence,
          latitude: input.latitude,
          longitude: input.longitude,
          speed: 0,
          accuracy: input.accuracy,
          source: input.source,
          timestamp: input.timestamp,
          receivedAt,
        });
        historySaved = true;
      } catch (err: any) {
        if (err.code === 11000) {
          logger.warn(`Duplicate location skipped for ${deviceId} at ${input.timestamp.toISOString()}`);
          historySaved = false;
        } else {
          throw err;
        }
      }
    }

    // 8. Determine if this location should update Device.latestLocation
    // Rule: Out-of-order or delayed SMS must not overwrite newer latest location
    let latestLocationUpdated = false;
    const currentLatest = device.latestLocation;
    const isNewerOrEqual =
      !currentLatest ||
      !currentLatest.timestamp ||
      inputTimestampMs >= new Date(currentLatest.timestamp).getTime();

    if (isNewerOrEqual) {
      device.latestLocation = {
        latitude: input.latitude,
        longitude: input.longitude,
        speed: 0,
        accuracy: input.accuracy,
        source: input.source,
        timestamp: input.timestamp,
        gpsFixed: true,
      };
      latestLocationUpdated = true;
    } else {
      logger.info(
        `Delayed/out-of-order SMS location for ${deviceId} saved to history but did not overwrite newer latest location`
      );
    }

    // 9. Update lastSmsSequence
    if (device.lastSmsSequence === null || device.lastSmsSequence === undefined || isNewSession) {
      device.lastSmsSequence = input.sequence;
    } else if (isNewerOrEqual) {
      device.lastSmsSequence = Math.max(device.lastSmsSequence, input.sequence);
    }

    // 10. Update lastSmsReceivedAt (always current server time of reception)
    device.lastSmsReceivedAt = receivedAt;

    // 11. Update lastSeenAt and device status
    // Safe Status Logic: Do not mark a device online if an old SMS was delivered late!
    const isFresh = Date.now() - inputTimestampMs <= env.DEVICE_OFFLINE_TIMEOUT_SECONDS * 1000;
    if (isFresh) {
      device.lastSeenAt = receivedAt;
      device.status = 'online';
    } else {
      // SMS was delayed/buffered. Only update lastSeenAt if it is newer than previous lastSeenAt.
      if (!device.lastSeenAt || input.timestamp > device.lastSeenAt) {
        device.lastSeenAt = input.timestamp;
      }
      device.status = devicesService.computeDeviceStatus(device.lastSeenAt);
    }

    // 12. Persist updated device state
    await device.save();

    // 13. Broadcast Socket.IO updates ONLY AFTER DB persistence succeeds
    socketService.emitDeviceStatus(deviceId, {
      deviceId,
      status: device.status,
      batteryPercent: device.batteryPercent ?? undefined,
      lastSeenAt: device.lastSeenAt ? device.lastSeenAt.toISOString() : receivedAt.toISOString(),
      gpsFixed: true,
    });

    if (latestLocationUpdated) {
      socketService.emitLocationUpdate(deviceId, {
        deviceId,
        latitude: input.latitude,
        longitude: input.longitude,
        speed: 0,
        accuracy: input.accuracy,
        source: input.source,
        timestamp: input.timestamp.toISOString(),
        gpsFixed: true,
        receivedAt: receivedAt.toISOString(),
      });
    }

    return {
      deviceId,
      sequence: input.sequence,
      receivedAt,
      latestLocationUpdated,
      historySaved,
      source: input.source,
      accuracy: input.accuracy,
      message: latestLocationUpdated
        ? 'SMS location ingested and latest coordinates updated successfully'
        : 'Delayed SMS location stored in history. Newer coordinates preserved.',
    };
  }
}

export const smsLocationService = new SmsLocationService();
