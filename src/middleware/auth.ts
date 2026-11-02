import type { NextFunction, Request, Response } from "express";
import { AUTH_COOKIE } from "../utils/cookies.js";
import { verifyToken } from "../utils/jwt.js";
import { sendError } from "../utils/helpers.js";
import type { AuthPayload } from "../types.js";

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthPayload;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[AUTH_COOKIE] as string | undefined;
  if (!token) {
    return sendError(res, 401, "Unauthorized access — please log in first.");
  }
  try {
    req.auth = verifyToken(token);
    next();
  } catch {
    sendError(res, 401, "Session expired or invalid — please log in again.");
  }
}
