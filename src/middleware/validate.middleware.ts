import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { sendError } from '../utils/apiResponse';

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = result.error.issues || [];
      const errorMessages = issues.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      }));
      sendError(res, 'Validation error', 400, errorMessages, 'VALIDATION_FAILED');
      return;
    }
    req.body = result.data;
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
