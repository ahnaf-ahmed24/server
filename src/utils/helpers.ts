import type { NextFunction, Request, RequestHandler, Response } from "express";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Express 5 friendly async wrapper so rejected promises hit the error handler. */
export const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function sendSuccess<T>(
  res: Response,
  data: T,
  message?: string,
  status = 200
) {
  res.status(status).json({ success: true, message, data });
}

export function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ success: false, message });
}
