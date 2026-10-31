import { z } from 'zod';
import { env } from '../../config/env';

/**
 * Normalizes phone numbers to standard E.164 format where possible.
 * Handles Indian numbers with or without +91, with leading 0, spaces, or hyphens.
 */
export function normalizePhoneNumber(rawNumber: string): string {
  if (!rawNumber) return '';
  // Remove all whitespace, hyphens, and brackets
  let cleaned = rawNumber.trim().replace(/[\s\-()]/g, '');

  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  }

  if (cleaned.startsWith('+')) {
    return cleaned;
  }

  // 10-digit Indian mobile number
  if (/^[6-9]\d{9}$/.test(cleaned)) {
    return `+91${cleaned}`;
  }

  // 11-digit with leading 0 (e.g. 09876543210)
  if (/^0[6-9]\d{9}$/.test(cleaned)) {
    return `+91${cleaned.slice(1)}`;
  }

  // 12-digit Indian number starting with 91
  if (/^91[6-9]\d{9}$/.test(cleaned)) {
    return `+${cleaned}`;
  }

  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

/**
 * Parses compact SMS string formatted as:
 * DEVICE=TRUCK001;SEQ=1025;LAT=28.677307;LON=77.499718;ACC=550;SRC=GNSS;TIME=1760000000
 */
export function parseSmsText(smsText: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!smsText || typeof smsText !== 'string') return result;

  const parts = smsText.trim().split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim().toUpperCase();
    const val = trimmed.slice(eqIdx + 1).trim();

    switch (key) {
      case 'DEVICE':
      case 'DEV':
      case 'ID':
        result.deviceId = val;
        break;
      case 'SEQ':
      case 'SEQUENCE':
        result.sequence = parseInt(val, 10);
        break;
      case 'LAT':
        result.latitude = parseFloat(val);
        break;
      case 'LON':
      case 'LNG':
        result.longitude = parseFloat(val);
        break;
      case 'ACC':
        result.accuracy = parseFloat(val);
        break;
      case 'SRC':
        result.source = val.toUpperCase();
        break;
      case 'TIME':
      case 'TIMESTAMP':
        if (/^\d+$/.test(val)) {
          const num = parseInt(val, 10);
          result.timestamp = num < 10000000000 ? num * 1000 : num;
        } else {
          result.timestamp = val;
        }
        break;
      case 'SIG':
        result.signature = val;
        break;
    }
  }

  return result;
}

// Preprocessor mapping camelCase / snake_case / rawMessage variations
const normalizeSmsLocationInput = (raw: unknown) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return raw;
  }
  const obj = { ...(raw as Record<string, unknown>) };

  // If rawMessage or smsText is supplied, parse fields from it if not already in body
  if (typeof obj.rawMessage === 'string' && obj.rawMessage.trim()) {
    const parsed = parseSmsText(obj.rawMessage);
    for (const [k, v] of Object.entries(parsed)) {
      if (obj[k] === undefined || obj[k] === null) {
        obj[k] = v;
      }
    }
  }

  const deviceId = obj.deviceId ?? obj.device_id ?? obj.DEVICE;
  const sequence = obj.sequence ?? obj.seq ?? obj.SEQ;
  const latitude = obj.latitude ?? obj.lat ?? obj.LAT;
  const longitude = obj.longitude ?? obj.lon ?? obj.lng ?? obj.LON;
  const accuracy = obj.accuracy ?? obj.acc ?? obj.ACC;
  const source = obj.source ?? obj.src ?? obj.SRC;
  const timestamp = obj.timestamp ?? obj.time ?? obj.TIME;
  const senderNumber = obj.senderNumber ?? obj.sender_number ?? obj.from ?? obj.sender;
  const signature = obj.signature ?? obj.sig ?? obj.SIG;

  return {
    ...obj,
    deviceId,
    sequence,
    latitude,
    longitude,
    accuracy,
    source,
    timestamp,
    senderNumber,
    signature,
  };
};

/**
 * Coerces and validates timestamp from unix epoch (seconds or ms), ISO 8601 string, or Date.
 */
const smsTimestampSchema = z
  .union([
    z.number(),
    z.string(),
    z.date(),
  ])
  .transform((val, ctx) => {
    let date: Date;
    if (val instanceof Date) {
      date = val;
    } else if (typeof val === 'number') {
      // 10-digit unix epoch in seconds vs 13-digit ms
      date = val < 10000000000 ? new Date(val * 1000) : new Date(val);
    } else if (typeof val === 'string') {
      const trimmed = val.trim();
      if (/^\d+$/.test(trimmed)) {
        const num = parseInt(trimmed, 10);
        date = num < 10000000000 ? new Date(num * 1000) : new Date(num);
      } else {
        date = new Date(trimmed);
      }
    } else {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid timestamp format',
      });
      return z.NEVER;
    }

    if (isNaN(date.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid timestamp value',
      });
      return z.NEVER;
    }

    const now = Date.now();
    const time = date.getTime();
    const ageMs = now - time;
    const maxAgeMs = env.MAX_GPS_AGE_HOURS * 3600 * 1000;
    const maxFutureSkewMs = 15 * 60 * 1000; // 15 min tolerance

    if (time - now > maxFutureSkewMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `GPS timestamp cannot be in the future: ${date.toISOString()}`,
      });
      return z.NEVER;
    }

    if (ageMs > maxAgeMs) {
      const ageHours = (ageMs / (3600 * 1000)).toFixed(1);
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `GPS timestamp is stale: ${date.toISOString()} (measured age: ${ageHours} hours, max allowed: ${env.MAX_GPS_AGE_HOURS} hours)`,
      });
      return z.NEVER;
    }

    return date;
  });

export const smsLocationIngestionSchema = z.preprocess(
  normalizeSmsLocationInput,
  z.object({
    deviceId: z
      .string({ message: 'deviceId is required' })
      .trim()
      .min(1, 'deviceId cannot be empty')
      .max(50, 'deviceId must not exceed 50 characters')
      .transform((val) => val.toUpperCase()),
    sequence: z.coerce
      .number({ message: 'sequence is required and must be an integer' })
      .int('sequence must be an integer')
      .min(0, 'sequence must be greater than or equal to 0'),
    latitude: z.coerce
      .number({ message: 'latitude is required and must be a number' })
      .min(-90, 'latitude must be between -90 and 90')
      .max(90, 'latitude must be between -90 and 90'),
    longitude: z.coerce
      .number({ message: 'longitude is required and must be a number' })
      .min(-180, 'longitude must be between -180 and 180')
      .max(180, 'longitude must be between -180 and 180'),
    accuracy: z.coerce
      .number({ message: 'accuracy must be a number' })
      .min(0, 'accuracy cannot be negative')
      .default(0),
    source: z
      .string({ message: 'source is required' })
      .trim()
      .toUpperCase()
      .refine((val) => ['GNSS', 'CELLULAR', 'SMS'].includes(val), {
        message: "source must be either 'GNSS' or 'CELLULAR'",
      })
      .default('GNSS'),
    timestamp: smsTimestampSchema,
    senderNumber: z
      .string({ message: 'senderNumber is required' })
      .trim()
      .min(7, 'senderNumber must be a valid phone number')
      .max(20, 'senderNumber too long')
      .transform((val) => normalizePhoneNumber(val)),
    rawMessage: z.string().optional(),
    signature: z.string().optional(),
  })
);

export type SmsLocationIngestionInput = z.infer<typeof smsLocationIngestionSchema>;
