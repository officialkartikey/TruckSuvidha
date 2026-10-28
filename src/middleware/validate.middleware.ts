import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { sendError } from '../utils/apiResponse';

export function validateBody(schema: ZodSchema, errorCode: string = 'VALIDATION_FAILED') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = result.error.issues || [];
      const errorMessages = issues.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      }));

      const context = res.locals.locationLogContext;
      if (context) {
        context.validation = {
          valid: false,
          errors: errorMessages,
        };
        context.error = {
          code: errorCode,
          message: errorMessages[0]?.message || 'Validation error',
          details: errorMessages,
        };
      }

      const summaryMessage = errorMessages.length === 1
        ? errorMessages[0].message
        : `Validation failed for ${errorMessages.map((e) => e.field).join(', ')}`;

      sendError(res, summaryMessage, 400, errorMessages, errorCode);
      return;
    }

    req.body = result.data;

    const context = res.locals.locationLogContext;
    if (context) {
      context.validation = { valid: true };
      const parsedData = result.data as Record<string, any>;
      if (parsedData?.deviceId) {
        context.deviceId = parsedData.deviceId;
      }
      if (parsedData?.seq !== undefined) {
        context.seq = parsedData.seq;
      }
    }

    next();
  };
}

export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const issues = result.error.issues || [];
      const errorMessages = issues.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      }));
      sendError(res, 'Invalid query parameters', 400, errorMessages, 'INVALID_QUERY');
      return;
    }
    // Support Express 5 where req.query has only a getter
    res.locals.validatedQuery = result.data;
    try {
      Object.assign(req.query, result.data);
    } catch {
      // Ignore if Object.assign fails
    }
    next();
  };
}
