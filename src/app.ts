import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";

import { env } from "./config/env";
import { getDb } from "./db/mongo";
import { notFoundHandler, errorHandler } from "./middleware/errors";
import { authRouter } from "./routes/auth";
import { studiosRouter } from "./routes/studios";
import { wishlistRouter } from "./routes/wishlist";
import { bookingsRouter } from "./routes/bookings";
import { reviewsRouter } from "./routes/reviews";

/**
 * The Express app — built with zero side effects (no listen, no DB connect)
 * so both the local server entry (src/server.ts) and the Vercel serverless
 * entry (api/[...path].ts) can import it safely.
 */
const app = express();

// Behind Render/Vercel proxies in production — keeps req.protocol correct for
// OAuth redirect URIs + secure cookies.
app.set("trust proxy", 1);

/* ------------------------------ middleware ----------------------------- */
app.use(
  cors({
    origin: env.clientOrigins,
    credentials: true, // auth JWT travels in an HTTPOnly cookie
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

/* -------------------------------- routes ------------------------------- */
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
app.use("/api", reviewsRouter); // nested paths: /api/studios/:id/reviews

/* --------------------------- 404 + error tails ------------------------- */
app.use(notFoundHandler);
app.use(errorHandler);

export { app };
export default app;
