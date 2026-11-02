import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/helpers.js";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    message: `API route not found: ${req.method} ${req.originalUrl}`,
  });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }

  const bodyError =
    typeof err === "object" && err !== null ? (err as { type?: string }).type : undefined;

  if (bodyError === "entity.parse.failed") {
    return res.status(400).json({ success: false, message: "Malformed JSON body." });
  }
  if (bodyError === "entity.too.large") {
    return res
      .status(413)
      .json({ success: false, message: "Request body too large (1 MB limit)." });
  }
  if (bodyError === "entity.verify.failed") {
    return res
      .status(400)
      .json({ success: false, message: "Request body failed verification." });
  }

  console.error("[StudioSpace API] Unhandled error:", err);
  res.status(500).json({ success: false, message: "Internal server error" });
}
