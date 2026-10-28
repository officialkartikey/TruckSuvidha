import { Response } from 'express';

export interface ApiResponse<T = unknown> {
  success: boolean;
  requestId?: string;
  message?: string;
  data?: T;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export function sendSuccess<T>(res: Response, data?: T, message?: string, statusCode: number = 200): Response {
  const requestId = res.locals?.requestId;
  const body: ApiResponse<T> = {
    success: true,
    ...(requestId ? { requestId } : {}),
    ...(message ? { message } : {}),
    ...(data !== undefined ? { data } : {}),
  };
  return res.status(statusCode).json(body);
}

export function sendError(
  res: Response,
  message: string,
  statusCode: number = 400,
  details?: unknown,
  code?: string
): Response {
  const requestId = res.locals?.requestId;
  const body: ApiResponse = {
    success: false,
    ...(requestId ? { requestId } : {}),
    message,
    error: {
      ...(code ? { code } : {}),
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
  return res.status(statusCode).json(body);
}
