import type { Response } from "express";
import { env } from "../config/env";

export const AUTH_COOKIE = "token";

const baseOptions = {
  httpOnly: true,
  path: "/",
  secure: env.isProd,
  sameSite: env.isProd ? ("none" as const) : ("lax" as const),
};

export function setAuthCookie(res: Response, token: string) {
  res.cookie(AUTH_COOKIE, token, { ...baseOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(AUTH_COOKIE, baseOptions);
}
