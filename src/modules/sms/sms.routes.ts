import { Router } from 'express';
import { smsLocationController } from './sms.controller';
import { requireAdminAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { smsLocationIngestionSchema } from './sms.schema';

const router = Router();

// Endpoint: POST /api/v1/sms/location
// Originates from Admin's Android Phone, authenticated with Admin JWT
router.post(
  '/location',
  requireAdminAuth,
  validateBody(smsLocationIngestionSchema, 'SMS_LOCATION_VALIDATION_FAILED'),
  (req, res, next) => {
    smsLocationController.ingestSmsLocation(req, res, next);
  }
);

export const smsRoutes = router;
