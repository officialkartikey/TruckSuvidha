import { Request, Response, NextFunction } from 'express';
import { authService, AdminPayload } from '../modules/auth/auth.service';
import { sendError } from '../utils/apiResponse';

declare global {
  namespace Express {
    interface Request {
      admin?: AdminPayload;
    }
  }
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendError(res, 'Authorization token required in format: Bearer <token>', 401, undefined, 'UNAUTHORIZED');
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = authService.verifyToken(token);
    req.admin = decoded;
    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      sendError(res, 'Authentication token has expired', 401, undefined, 'TOKEN_EXPIRED');
      return;
    }
    sendError(res, 'Invalid or corrupted authentication token', 401, undefined, 'INVALID_TOKEN');
  }
}
