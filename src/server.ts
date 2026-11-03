import type { Server } from "node:http";

import app from "./app.js";
import { env, clientOrigin } from "./config/env.js";
import { getDb } from "./db/mongo.js";

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

  start();
}

if (!process.env.VERCEL) {
  void boot();
}

export { server, app };
export default app;
