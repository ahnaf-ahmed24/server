/**
 * Vercel serverless entry point.
 *
 * Every StudioSpace route lives under `/api/*`, so a single catch-all
 * function covers the entire API surface and Express receives the original
 * request path (e.g. `/api/studios/mine`) untouched.
 *
 * `src/app.ts` has no side effects: the platform invokes this exported app
 * per request; nothing binds a port or connects at import time.
 */
import app from "../src/app.js";

export default app;
