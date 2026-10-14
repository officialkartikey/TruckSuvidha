import { Router } from 'express';
import { devicesController } from './devices.controller';
import { locationsController } from '../locations/locations.controller';
import { requireAdminAuth } from '../../middleware/auth.middleware';
import { validateBody, validateQuery } from '../../middleware/validate.middleware';
import { registerDeviceSchema, updateDeviceSchema } from './devices.schema';
import { locationHistoryQuerySchema } from '../locations/locations.schema';

const router = Router();

// All device routes require Admin Authentication
router.use(requireAdminAuth);

router.post('/', validateBody(registerDeviceSchema), (req, res, next) => {
  devicesController.register(req, res, next);
});

router.get('/', (req, res, next) => {
  devicesController.list(req, res, next);
});

router.get('/:deviceId', (req, res, next) => {
  devicesController.getOne(req, res, next);
});

router.patch('/:deviceId', validateBody(updateDeviceSchema), (req, res, next) => {
  devicesController.update(req, res, next);
});

router.delete('/:deviceId', (req, res, next) => {
  devicesController.delete(req, res, next);
});

router.post('/:deviceId/rotate-key', (req, res, next) => {
  devicesController.rotateKey(req, res, next);
});

// Location history query for a specific device: GET /api/v1/devices/:deviceId/locations
router.get('/:deviceId/locations', validateQuery(locationHistoryQuerySchema), (req, res, next) => {
  locationsController.getHistory(req, res, next);
});

export const devicesRoutes = router;
