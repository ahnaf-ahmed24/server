import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";

import { env } from "./config/env.js";
import { getDb } from "./db/mongo.js";
import { notFoundHandler, errorHandler } from "./middleware/errors.js";
import { authRouter } from "./routes/auth.js";
import { studiosRouter } from "./routes/studios.js";
import { wishlistRouter } from "./routes/wishlist.js";
import { bookingsRouter } from "./routes/bookings.js";
import { reviewsRouter } from "./routes/reviews.js";

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

app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "StudioSpace API is running.",
    data: {
      service: "StudioSpace API",
      health: "/api/health",
      apiBase: "/api",
      time: new Date().toISOString(),
    },
  });
});

app.get("/api", (_req, res) => {
  res.json({
    success: true,
    message: "StudioSpace API root. Endpoints are mounted under /api/<resource>.",
    data: {
      health: "/api/health",
      resources: ["auth", "studios", "wishlist", "bookings", "reviews"],
    },
  });
});

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

export { app };
export default app;
