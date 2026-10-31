import { Request, Response, NextFunction } from 'express';
import { smsLocationService } from './sms.service';
import { sendSuccess } from '../../utils/apiResponse';

export class SmsLocationController {
  async ingestSmsLocation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const adminId = req.admin!.id;
      const payload = res.locals.validatedBody || req.body;
      const result = await smsLocationService.processSmsLocation(adminId, payload);
      sendSuccess(res, result, result.message, 200);
    } catch (error) {
      next(error);
    }
  }
}

export const smsLocationController = new SmsLocationController();
