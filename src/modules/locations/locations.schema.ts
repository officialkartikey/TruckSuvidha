import { z } from 'zod';
import { env } from '../../config/env';

// Preprocess raw input object mapping snake_case ESP32 fields to canonical camelCase fields
const normalizeLocationInput = (raw: unknown) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return raw;
  }
  const obj = raw as Record<string, unknown>;

  const deviceId = obj.deviceId ?? obj.device_id;
  const latitude = obj.latitude ?? obj.lat;
  const longitude = obj.longitude ?? obj.lng ?? obj.lon;
  const speed = obj.speed ?? obj.speed_kmph;
  const gpsFixed = obj.gpsFixed ?? obj.fix_valid ?? obj.gps_fixed;

  // If timestamp is empty string (""), null, or undefined, fallback to current server time
  const rawTimestamp = obj.timestamp ?? obj.gps_utc;
  const timestamp =
    (typeof rawTimestamp === 'string' && rawTimestamp.trim().length === 0) ||
    rawTimestamp === undefined ||
    rawTimestamp === null
      ? new Date().toISOString()
      : rawTimestamp;

  const batteryPercent = obj.batteryPercent ?? obj.battery_percent;
  const seq = obj.seq ?? obj.sequence_number ?? obj.sequenceNumber;
  const sessionId = obj.sessionId ?? obj.session_id ?? obj.bootId ?? obj.boot_id;
  const apiKey = obj.apiKey ?? obj.api_key;

  // Fallback positioningSource to CELLULAR_LBS if coordinates are non-zero
  const hasCoordinates =
    latitude !== undefined &&
    latitude !== null &&
    longitude !== undefined &&
    longitude !== null &&
    (Number(latitude) !== 0 || Number(longitude) !== 0);

  const positioningSource =
    obj.positioningSource ??
    obj.positioning_source ??
    obj.source ??
    (hasCoordinates ? 'CELLULAR_LBS' : undefined);

  const accuracyMeters = obj.accuracyMeters ?? obj.accuracy_meters ?? obj.accuracy;

  return {
    ...obj,
    deviceId,
    latitude,
    longitude,
    speed,
    gpsFixed,
    timestamp,
    batteryPercent,
    seq,
    sessionId,
    apiKey,
    positioningSource,
    accuracyMeters,
  };
};

// Coerce boolean from boolean, strings like "true"/"false", or numbers 1/0
const booleanCoercion = z.preprocess((val) => {
  if (val === undefined || val === null) {
    return false;
  }
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
  }
  if (typeof val === 'number') {
    if (val === 1) return true;
    if (val === 0) return false;
  }
  return val;
}, z.boolean({ message: 'gpsFixed (or fix_valid) must be a boolean' }));

export const locationIngestionSchema = z.preprocess(
  normalizeLocationInput,
  z.object({
    deviceId: z
      .string({ message: 'deviceId (or device_id) is required' })
      .trim()
      .min(1, 'deviceId is required')
      .max(50)
      .transform((val) => val.toUpperCase()),
    timestamp: z
      .string({ message: 'timestamp (or gps_utc) must be a valid ISO 8601 string' })
      .datetime({ message: 'timestamp (or gps_utc) must be a valid ISO 8601 string (e.g. 2026-10-28T05:45:52Z)' })
      .transform((val) => new Date(val))
      .superRefine((val, ctx) => {
        const now = Date.now();
        const time = val.getTime();
        const ageMs = now - time;
        const maxAgeMs = env.MAX_GPS_AGE_HOURS * 3600 * 1000;
        const maxFutureSkewMs = 15 * 60 * 1000; // 15 minutes clock drift tolerance

        // Future timestamp check
        if (time - now > maxFutureSkewMs) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `GPS timestamp cannot be in the future: ${val.toISOString()}`,
          });
          return;
        }

        // Stale timestamp check
        if (ageMs > maxAgeMs) {
          const ageHours = (ageMs / (3600 * 1000)).toFixed(1);
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `GPS timestamp is stale: ${val.toISOString()} (measured age: ${ageHours} hours, max allowed: ${env.MAX_GPS_AGE_HOURS} hours)`,
          });
        }
      }),
    latitude: z.coerce
      .number({ message: 'latitude is required and must be a number' })
      .min(-90, 'latitude must be between -90 and 90')
      .max(90, 'latitude must be between -90 and 90'),
    longitude: z.coerce
      .number({ message: 'longitude is required and must be a number' })
      .min(-180, 'longitude must be between -180 and 180')
      .max(180, 'longitude must be between -180 and 180'),
    speed: z.preprocess(
      (val) => (val === null || val === undefined || val === '' ? 0 : val),
      z.coerce
        .number({ message: 'speed (or speed_kmph) must be a number' })
        .min(0, 'speed cannot be negative')
        .default(0)
    ),
    gpsFixed: booleanCoercion.optional().default(false),
    positioningSource: z
      .string()
      .trim()
      .transform((val) => val.toUpperCase())
      .optional()
      .nullable(),
    accuracyMeters: z.preprocess(
      (val) => (val === null || val === undefined || val === '' ? null : val),
      z.coerce
        .number({ message: 'accuracyMeters must be a number' })
        .min(0, 'accuracyMeters cannot be negative')
        .optional()
        .nullable()
    ),
    batteryPercent: z.coerce
      .number({ message: 'batteryPercent (or battery_percent) must be a number between 0 and 100' })
      .min(0, 'batteryPercent must be between 0 and 100')
      .max(100, 'batteryPercent must be between 0 and 100')
      .optional()
      .nullable(),
    seq: z.coerce
      .number({ message: 'seq must be a non-negative integer' })
      .int('seq must be an integer')
      .min(0, 'seq must be greater than or equal to 0')
      .optional()
      .nullable(),
    sessionId: z
      .string()
      .trim()
      .max(100)
      .optional()
      .nullable(),
    apiKey: z.string().optional(),
  })
);

export const locationHistoryQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? Math.min(Math.max(parseInt(val, 10) || 50, 1), 500) : 50)),
  from: z
    .string()
    .datetime()
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
  to: z
    .string()
    .datetime()
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
});

export type LocationIngestionInput = z.infer<typeof locationIngestionSchema>;
export type LocationHistoryQueryInput = z.infer<typeof locationHistoryQuerySchema>;
