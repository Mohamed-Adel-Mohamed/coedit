import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger.js';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Sign in to continue') =>
  new ApiError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do that') =>
  new ApiError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new ApiError(404, 'not_found', message);
export const conflict = (message: string) => new ApiError(409, 'conflict', message);
export const gone = (message: string) => new ApiError(410, 'gone', message);
export const tooManyRequests = (message = 'Too many requests — try again shortly') =>
  new ApiError(429, 'rate_limited', message);

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof ApiError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'bad_request',
        message: 'Some fields were invalid',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({
      error: { code: 'bad_request', message: 'Request body is not valid JSON' },
    });
    return;
  }
  logger.error(
    { err: error, method: req.method, url: req.originalUrl },
    'unhandled request error',
  );
  res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong on our side' },
  });
};

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'Unknown endpoint' } });
};
