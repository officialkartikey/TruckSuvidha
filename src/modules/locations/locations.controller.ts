import { Request, Response, NextFunction } from 'express';
import { locationsService } from './locations.service';
import { sendSuccess } from '../../utils/apiResponse';

export class LocationsController {
  async ingestLocation(req: Request, res: Response, next: NextFunction): Promise<void> {
    const context = res.locals.locationLogContext;
    try {
      const device = req.device!;
      const result = await locationsService.processLocation(req.body, device);
      if (context) {
        context.db = {
          success: true,
          latestLocationUpdated: result.latestLocationUpdated,
          historySaved: result.historySaved,
        };
      }
      sendSuccess(res, result, result.message, 200);
    } catch (error: any) {
      if (context) {
        context.db = {
          success: false,
          error: error?.message || 'Database operation failed',
        };
      }
      next(error);
    }
  }

  async getHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const adminId = req.admin!.id;
      const deviceId = req.params.deviceId as string;
      const query = res.locals.validatedQuery || req.query;
      const history = await locationsService.getLocationHistory(adminId, deviceId, query as any);
      sendSuccess(res, history, 'Location history retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
}

export const locationsController = new LocationsController();
