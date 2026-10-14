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
  try {
    // Extract API key from x-device-key header or Authorization: Bearer <key>
    const authHeader = req.headers.authorization;
    const customHeader = req.headers['x-device-key'];

    let apiKey: string | undefined;
    if (typeof customHeader === 'string' && customHeader.trim()) {
      apiKey = customHeader.trim();
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
      apiKey = authHeader.split(' ')[1]?.trim();
    }

    if (!apiKey) {
      sendError(
        res,
        'Device authentication required. Provide API key via x-device-key header or Bearer token',
        401,
        undefined,
        'DEVICE_AUTH_REQUIRED'
      );
      return;
    }

    // Extract deviceId from body or header
    const deviceId = (req.body?.deviceId || req.headers['x-device-id'] as string)?.trim().toUpperCase();

    if (!deviceId) {
      sendError(res, 'deviceId is required in request body or x-device-id header', 400, undefined, 'DEVICE_ID_REQUIRED');
      return;
    }

    // Find device in database
    const device = await Device.findOne({ deviceId });
    if (!device) {
      sendError(res, 'Invalid device credentials', 401, undefined, 'INVALID_DEVICE_CREDENTIALS');
      return;
    }

    // Verify API key hash
    const isValidKey = verifyDeviceApiKey(apiKey, device.apiKeyHash);
    if (!isValidKey) {
      sendError(res, 'Invalid device credentials', 401, undefined, 'INVALID_DEVICE_CREDENTIALS');
      return;
    }

    // Ensure authenticated device matches body deviceId if body deviceId is provided
    if (req.body?.deviceId && req.body.deviceId.trim().toUpperCase() !== device.deviceId) {
      sendError(res, 'Authenticated device does not match payload deviceId', 403, undefined, 'DEVICE_ID_MISMATCH');
      return;
    }

    req.device = device;
    next();
  } catch (error) {
    next(error);
  }
}
