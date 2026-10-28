import { Request, Response, NextFunction } from 'express';
import { Device, IDevice } from '../modules/devices/device.model';
import { verifyDeviceApiKey } from '../utils/crypto';
import { sendError } from '../utils/apiResponse';

declare global {
  namespace Express {
    interface Request {
      device?: IDevice;
    }
  }
}

export async function requireDeviceAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const context = res.locals.locationLogContext;

  try {
    // Extract API key from x-device-key header, Authorization: Bearer <key>, or body apiKey/api_key
    const authHeader = req.headers.authorization;
    const customHeader = req.headers['x-device-key'];
    const bodyApiKey = req.body?.apiKey || req.body?.api_key;

    let apiKey: string | undefined;
    if (typeof customHeader === 'string' && customHeader.trim()) {
      apiKey = customHeader.trim();
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
      apiKey = authHeader.split(' ')[1]?.trim();
    } else if (typeof bodyApiKey === 'string' && bodyApiKey.trim()) {
      apiKey = bodyApiKey.trim();
    }

    if (!apiKey) {
      if (context) {
        context.auth = { authorized: false, reason: 'DEVICE_AUTH_REQUIRED' };
        context.error = {
          code: 'DEVICE_AUTH_REQUIRED',
          message: 'Device authentication required. Provide API key via x-device-key header or Bearer token',
        };
      }
      sendError(
        res,
        'Device authentication required. Provide API key via x-device-key header or Bearer token',
        401,
        undefined,
        'DEVICE_AUTH_REQUIRED'
      );
      return;
    }

    // Extract deviceId from body (deviceId or device_id) or header (x-device-id)
    const rawDeviceId = req.body?.deviceId || req.body?.device_id || req.headers['x-device-id'];
    const deviceId = rawDeviceId ? String(rawDeviceId).trim().toUpperCase() : undefined;

    if (!deviceId) {
      if (context) {
        context.auth = { authorized: false, reason: 'DEVICE_ID_REQUIRED' };
        context.error = { code: 'DEVICE_ID_REQUIRED', message: 'deviceId is required in request body or x-device-id header' };
      }
      sendError(res, 'deviceId is required in request body or x-device-id header', 400, undefined, 'DEVICE_ID_REQUIRED');
      return;
    }

    // Find device in database
    const device = await Device.findOne({ deviceId });
    if (!device) {
      if (context) {
        context.auth = { authorized: false, reason: 'DEVICE_NOT_FOUND' };
        context.error = { code: 'DEVICE_NOT_FOUND', message: `Device '${deviceId}' not found` };
      }
      sendError(res, `Device '${deviceId}' not found`, 404, undefined, 'DEVICE_NOT_FOUND');
      return;
    }

    // Verify API key hash
    const isValidKey = verifyDeviceApiKey(apiKey, device.apiKeyHash);
    if (!isValidKey) {
      if (context) {
        context.auth = { authorized: false, reason: 'INVALID_DEVICE_CREDENTIALS' };
        context.error = { code: 'INVALID_DEVICE_CREDENTIALS', message: 'Invalid device credentials' };
      }
      sendError(res, 'Invalid device credentials', 401, undefined, 'INVALID_DEVICE_CREDENTIALS');
      return;
    }

    // Ensure authenticated device matches body deviceId if body deviceId is provided
    const payloadDeviceId = (req.body?.deviceId || req.body?.device_id)?.toString().trim().toUpperCase();
    if (payloadDeviceId && payloadDeviceId !== device.deviceId) {
      if (context) {
        context.auth = { authorized: false, reason: 'DEVICE_ID_MISMATCH' };
        context.error = { code: 'DEVICE_ID_MISMATCH', message: 'Authenticated device does not match payload deviceId' };
      }
      sendError(res, 'Authenticated device does not match payload deviceId', 403, undefined, 'DEVICE_ID_MISMATCH');
      return;
    }

    if (context) {
      context.auth = { authorized: true };
      context.deviceId = device.deviceId;
    }

    req.device = device;
    next();
  } catch (error) {
    next(error);
  }
}
