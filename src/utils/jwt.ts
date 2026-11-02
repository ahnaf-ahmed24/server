import jwt, { type SignOptions } from "jsonwebtoken";
import type { AuthPayload } from "../types";
import { env } from "../config/env";

const TOKEN_TTL = "7d";

export function signToken(payload: AuthPayload): string {
  const options: SignOptions = { expiresIn: TOKEN_TTL };
  return jwt.sign(payload, env.jwtSecret, options);
}

export function verifyToken(token: string): AuthPayload {
  const decoded = jwt.verify(token, env.jwtSecret);
  if (typeof decoded === "string") {
    throw new Error("Invalid token payload");
  }
  return decoded as AuthPayload;
}
