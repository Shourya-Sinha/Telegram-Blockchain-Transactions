import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 does NOT forward rejections from async route handlers to the error
 * middleware — the rejection becomes an unhandled promise rejection and, since
 * Node 15, that terminates the whole process by default. That is how a simple
 * "insufficient balance" business error used to take down the bot, the API and
 * the workers together.
 *
 * Every async route handler must be wrapped with this helper so rejections
 * reach the centralized error handler and come back as a clean 4xx/5xx JSON
 * response that the Mini App / admin console can show as a toast.
 */
export const asyncHandler =
  (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
