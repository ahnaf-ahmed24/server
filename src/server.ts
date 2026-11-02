import type { Server } from "node:http";

import app from "./app";
import { env, clientOrigin } from "./config/env";
import { getDb } from "./db/mongo";

/**
 * Local/long-running entry point. Builds the app (no side effects) and only
 * binds a port in-process — on Vercel the platform invokes the exported app
 * itself, so an import here must never listen or connect at module top-level.
 */

let server: Server | null = null;

function start(): Server {
  server = app.listen(env.port, () => {
    console.log("─────────────────────────────────────────────────");
    console.log(`🎧 StudioSpace API listening on port ${env.port}`);
    console.log(`   Health      → http://localhost:${env.port}/api/health`);
    console.log(`   CORS origins→ ${env.clientOrigins.join(", ")}`);
    console.log(`   Client UI   → ${clientOrigin}`);
    console.log("   ─ Social OAuth — register these callback URLs with the providers:");
    console.log(
      `   Google  → http://localhost:${env.port}/api/auth/google/callback`
    );
    console.log(
      `   GitHub  → http://localhost:${env.port}/api/auth/github/callback`
    );
    console.log("─────────────────────────────────────────────────");
  });
  return server;
}

/** Fail loudly if the DB is unreachable at boot so misconfiguration is obvious. */
async function boot(): Promise<void> {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    console.log("✅ Connected to MongoDB.");
  } catch (error) {
    console.error(
      "❌ Could not connect to MongoDB at startup:",
      error instanceof Error ? error.message : error
    );
    console.error(
      "   Set MONGODB_URI in server/.env (or run `npm run dev:db` for an embedded dev database)."
    );
  }
  // Keep serving /api/health so the failure is observable from the client.
  start();
}

// Serverless runtimes (Vercel sets VERCEL=1) invoke the handler per request —
// never bind a port there, which would also make `tsx` hang after import.
if (!process.env.VERCEL) {
  void boot();
}

export { server, app };
export default app;
