import { Request, Response, NextFunction } from 'express';
import { devicesService } from './devices.service';
import { sendSuccess } from '../../utils/apiResponse';

export class DevicesController {
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const adminId = req.admin!.id;
      const result = await devicesService.registerDevice(adminId, req.body);
      sendSuccess(res, result, 'Device registered successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const adminId = req.admin!.id;
      const devices = await devicesService.listDevices(adminId);
      sendSuccess(res, devices, 'Devices retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async getOne(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const adminId = req.admin!.id;
      const deviceId = req.params.deviceId as string;
      const device = await devicesService.getDevice(adminId, deviceId);
      sendSuccess(res, device, 'Device details retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const adminId = req.admin!.id;
      const deviceId = req.params.deviceId as string;
      const device = await devicesService.updateDevice(adminId, deviceId, req.body);
      sendSuccess(res, device, 'Device updated successfully');
    } catch (error) {
      next(error);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const adminId = req.admin!.id;
      const deviceId = req.params.deviceId as string;
      await devicesService.deleteDevice(adminId, deviceId);
      sendSuccess(res, { deviceId: deviceId.toUpperCase() }, 'Device deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  async rotateKey(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const adminId = req.admin!.id;
      const deviceId = req.params.deviceId as string;
      const result = await devicesService.rotateApiKey(adminId, deviceId);
      sendSuccess(res, result, 'Device API key rotated successfully');
    } catch (error) {
      next(error);
    }
  }
}

export const devicesController = new DevicesController();
