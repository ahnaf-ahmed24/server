import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import type { Server } from "node:http";

import { env, clientOrigin } from "./config/env";
import { getDb } from "./db/mongo";
import { notFoundHandler, errorHandler } from "./middleware/errors";
import { authRouter } from "./routes/auth";
import { studiosRouter } from "./routes/studios";
import { wishlistRouter } from "./routes/wishlist";
import { bookingsRouter } from "./routes/bookings";
import { reviewsRouter } from "./routes/reviews";

const app = express();

app.set("trust proxy", 1);
app.use(
  cors({
    origin: env.clientOrigins,
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/api/health", async (_req, res) => {
  let dbStatus = "connected";
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
  } catch {
    dbStatus = "unreachable";
  }
  res.json({
    success: true,
    message: "StudioSpace API is running.",
    data: {
      ok: true,
      db: dbStatus,
      time: new Date().toISOString(),
    },
  });
});

app.use("/api/auth", authRouter);
app.use("/api/studios", studiosRouter);
app.use("/api/wishlist", wishlistRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api", reviewsRouter); 

app.use(notFoundHandler);
app.use(errorHandler);

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

getDb()
  .then(async (db) => {
    await db.command({ ping: 1 });
    console.log("✅ Connected to MongoDB.");
    start();
  })
  .catch((error) => {
    console.error(
      "❌ Could not connect to MongoDB at startup:",
      error instanceof Error ? error.message : error
    );
    console.error(
      "   Set MONGODB_URI in server/.env (or run `npm run dev:db` for an embedded dev database)."
    );
    start();
  });

export default app;
