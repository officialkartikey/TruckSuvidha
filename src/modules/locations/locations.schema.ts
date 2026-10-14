import { z } from 'zod';

export const locationIngestionSchema = z.object({
  deviceId: z
    .string()
    .trim()
    .min(1, 'deviceId is required')
    .max(50)
    .transform((val) => val.toUpperCase()),
  timestamp: z
    .string({ message: 'timestamp must be a valid ISO 8601 string' })
    .datetime({ message: 'timestamp must be a valid ISO 8601 string (e.g. 2026-10-13T12:30:00Z)' })
    .transform((val) => new Date(val)),
  latitude: z
    .number({ message: 'latitude is required and must be a number' })
    .min(-90, 'latitude must be between -90 and 90')
    .max(90, 'latitude must be between -90 and 90'),
  longitude: z
    .number({ message: 'longitude is required and must be a number' })
    .min(-180, 'longitude must be between -180 and 180')
    .max(180, 'longitude must be between -180 and 180'),
  speed: z
    .number({ message: 'speed is required and must be a number' })
    .min(0, 'speed cannot be negative'),
  gpsFixed: z.boolean({ message: 'gpsFixed boolean is required' }),
  batteryPercent: z
    .number({ message: 'batteryPercent is required and must be a number' })
    .min(0, 'batteryPercent must be between 0 and 100')
    .max(100, 'batteryPercent must be between 0 and 100'),
});

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
