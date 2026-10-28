import { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';

export interface LocationLogContext {
  startTime: number;
  requestId: string;
  method: string;
  path: string;
  contentType?: string;
  contentLength?: string;
  deviceId?: string;
  seq?: number;
  latitude?: number;
  longitude?: number;
  speed_kmph?: number;
  gps_utc?: string;
  fix_valid?: boolean;
  payload?: Record<string, unknown>;
  validation?: {
    valid: boolean;
    errors?: unknown;
  };
  auth?: {
    authorized: boolean;
    reason?: string;
  };
  db?: {
    success: boolean;
    latestLocationUpdated?: boolean;
    historySaved?: boolean;
    error?: string;
  };
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
    stack?: string;
  };
}

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
    interface Locals {
      requestId?: string;
      locationLogContext?: LocationLogContext;
    }
  }
}

/**
 * Extracts and sanitizes expected location fields from incoming body without exposing secrets.
 */
function extractSanitizedPayload(body: any): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};

  if (body.latitude !== undefined || body.lat !== undefined) {
    sanitized.latitude = body.latitude ?? body.lat;
  }
  if (body.longitude !== undefined || body.lng !== undefined || body.lon !== undefined) {
    sanitized.longitude = body.longitude ?? body.lng ?? body.lon;
  }
  if (body.speed_kmph !== undefined || body.speed !== undefined) {
    sanitized.speed_kmph = body.speed_kmph ?? body.speed;
  }
  if (body.gps_utc !== undefined || body.timestamp !== undefined) {
    const rawTime = body.gps_utc ?? body.timestamp;
    sanitized.gps_utc = rawTime instanceof Date ? rawTime.toISOString() : String(rawTime);
  }
  if (body.fix_valid !== undefined || body.gpsFixed !== undefined || body.gps_fixed !== undefined) {
    sanitized.fix_valid = body.fix_valid ?? body.gpsFixed ?? body.gps_fixed;
  }
  if (body.batteryPercent !== undefined || body.battery_percent !== undefined) {
    sanitized.battery_percent = body.batteryPercent ?? body.battery_percent;
  }
  if (body.seq !== undefined || body.sequence_number !== undefined) {
    sanitized.seq = body.seq ?? body.sequence_number;
  }
  if (body.device_id !== undefined || body.deviceId !== undefined) {
    sanitized.device_id = body.device_id ?? body.deviceId;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export function locationLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const requestId = res.locals.requestId || req.requestId || 'unknown-req-id';
  const method = req.method;
  const path = req.originalUrl || req.path;
  const contentType = req.headers['content-type'];
  const contentLength = req.headers['content-length'];

  const initialPayload = extractSanitizedPayload(req.body);

  const context: LocationLogContext = {
    startTime,
    requestId,
    method,
    path,
    contentType,
    contentLength,
    deviceId: (req.body?.deviceId || req.body?.device_id || req.headers['x-device-id'])?.toString().trim().toUpperCase(),
    seq: typeof req.body?.seq === 'number' ? req.body.seq : (typeof req.body?.sequence_number === 'number' ? req.body.sequence_number : undefined),
    latitude: req.body?.latitude ?? req.body?.lat,
    longitude: req.body?.longitude ?? req.body?.lng ?? req.body?.lon,
    speed_kmph: req.body?.speed_kmph ?? req.body?.speed,
    gps_utc: req.body?.gps_utc ?? (req.body?.timestamp instanceof Date ? req.body.timestamp.toISOString() : req.body?.timestamp),
    fix_valid: req.body?.fix_valid ?? req.body?.gpsFixed ?? req.body?.gps_fixed,
    payload: initialPayload,
  };

  res.locals.locationLogContext = context;

  // Emit structured log when response finishes
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const isError = res.statusCode >= 400;
    const level: 'info' | 'error' = isError ? 'error' : 'info';

    // Refresh context fields that may have been enriched during request processing
    const currentPayload = extractSanitizedPayload(req.body) || context.payload;

    const structuredLog: Record<string, unknown> = {
      level,
      timestamp: new Date().toISOString(),
      requestId,
      method,
      path,
      statusCode: res.statusCode,
      durationMs: duration,
      ...(contentType ? { contentType } : {}),
      ...(contentLength ? { contentLength } : {}),
      ...(context.deviceId ? { deviceId: context.deviceId } : {}),
      ...(context.seq !== undefined ? { seq: context.seq } : {}),
      ...(currentPayload ? { payload: currentPayload } : {}),
      ...(context.validation ? { validation: context.validation } : {}),
      ...(context.auth ? { auth: context.auth } : {}),
      ...(context.db ? { db: context.db } : {}),
    };

    if (isError && context.error) {
      structuredLog.error = {
        code: context.error.code,
        message: context.error.message,
        details: context.error.details,
      };
    }

    const logJson = JSON.stringify(structuredLog);
    if (level === 'error') {
      console.error(logJson);
      if (context.error?.stack && res.statusCode >= 500) {
        console.error(`[${context.requestId}] Stack trace:`, context.error.stack);
      }
    } else {
      console.log(logJson);
    }
  });

  next();
}
