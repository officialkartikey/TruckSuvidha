import { Router } from 'express';
import { locationsController } from './locations.controller';
import { requireDeviceAuth } from '../../middleware/deviceAuth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { locationIngestionSchema } from './locations.schema';
import { deviceRateLimiter } from '../../middleware/rateLimiter.middleware';
import { locationLoggingMiddleware } from './locationLogger.middleware';

const router = Router();

// Device ingestion endpoint: POST /api/v1/device/location
router.post(
  '/location',
  locationLoggingMiddleware,
  deviceRateLimiter,
  validateBody(locationIngestionSchema, 'LOCATION_VALIDATION_FAILED'),
  requireDeviceAuth,
  (req, res, next) => {
    locationsController.ingestLocation(req, res, next);
  }
);

export const deviceLocationRoutes = router;
