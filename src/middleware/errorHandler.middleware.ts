import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { sendError } from '../utils/apiResponse';

export class AppError extends Error {
  statusCode: number;
  code?: string;
  details?: unknown;

  constructor(message: string, statusCode: number = 400, code?: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, `Route ${req.method} ${req.originalUrl} not found`, 404, undefined, 'NOT_FOUND');
}

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const context = res.locals?.locationLogContext;

  logger.error('Unhandled request error:', err);

  if (err instanceof AppError) {
    if (context) {
      context.error = {
        code: err.code || 'APP_ERROR',
        message: err.message,
        details: err.details,
      };
    }
    sendError(res, err.message, err.statusCode, err.details, err.code);
    return;
  }

  // Handle Mongoose duplicate key error (E11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    const message = `Duplicate value for ${field}. A record with this value already exists.`;
    if (context) {
      context.error = { code: 'DUPLICATE_KEY', message };
    }
    sendError(res, message, 409, undefined, 'DUPLICATE_KEY');
    return;
  }

  // Handle Mongoose CastError (e.g. invalid ObjectId)
  if (err.name === 'CastError') {
    const message = `Invalid format for field: ${err.path}`;
    if (context) {
      context.error = { code: 'INVALID_FORMAT', message };
    }
    sendError(res, message, 400, undefined, 'INVALID_FORMAT');
    return;
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    if (context) {
      context.error = { code: 'INVALID_TOKEN', message: 'Invalid authentication token' };
    }
    sendError(res, 'Invalid authentication token', 401, undefined, 'INVALID_TOKEN');
    return;
  }
  if (err.name === 'TokenExpiredError') {
    if (context) {
      context.error = { code: 'TOKEN_EXPIRED', message: 'Authentication token has expired' };
    }
    sendError(res, 'Authentication token has expired', 401, undefined, 'TOKEN_EXPIRED');
    return;
  }

  // Handle JSON syntax error in request body
  if (err instanceof SyntaxError && 'body' in err) {
    const message = 'Malformed JSON in request body';
    if (context) {
      context.error = { code: 'BAD_JSON', message };
    }
    sendError(res, message, 400, undefined, 'BAD_JSON');
    return;
  }

  // Fallback internal server error
  if (context) {
    context.error = {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      stack: err?.stack,
    };
  }
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message || 'Internal server error';
  sendError(res, message, 500, undefined, 'INTERNAL_SERVER_ERROR');
}
