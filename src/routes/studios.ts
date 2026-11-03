import { Router } from "express";
import { ObjectId, type WithId } from "mongodb";
import { getCollection } from "../db/mongo.js";
import { requireAuth } from "../middleware/auth.js";
import { HttpError, sendSuccess, wrap } from "../utils/helpers.js";
import { serializeStudio } from "../utils/serialize.js";
import { authedUser } from "../utils/current-user.js";
import { serializeReview } from "./reviews.js";
import type { BookingDoc, ReviewDoc, StudioDoc } from "../types.js";

export const studiosRouter = Router();

type SortKey = "default" | "price-asc" | "price-desc" | "rating" | "newest";

const SORTS: Record<SortKey, Record<string, 1 | -1>> = {
  default: { createdAt: -1 },
  newest: { createdAt: -1 },
  "price-asc": { hourlyRate: 1, rating: -1 },
  "price-desc": { hourlyRate: -1, rating: -1 },
  rating: { rating: -1, reviewsCount: -1 },
};

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const DATE_TODAY_GUARD = undefined; 

const CATEGORIES = [
  "Photo Studios",
  "Sound Stages",
  "Podcast Rooms",
  "Music Suites",
  "Art Workshops",
];

const httpUrl = (value: string) => /^https?:\/\/\S+$/.test(value);


interface StudioInput {
  title: string;
  category: string;
  hourlyRate: number;
  deposit: number;
  capacity: number;
  location: string;
  image: string;
  gallery: string[];
  amenities: string[];
  overview: string;
}

const clampStrings = (raw: string | string[] | undefined): string[] => {
  if (Array.isArray(raw)) return raw.map((a) => String(a).trim()).filter(Boolean);
  if (typeof raw === "string")
    return raw
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
  return [];
};

function parseStudioInput(body: Record<string, unknown>): StudioInput {
  const title = String(body.title ?? "").trim();
  const category = String(body.category ?? "").trim();
  const location = String(body.location ?? "").trim();
  const overview = String(body.overview ?? "").trim();
  const hourlyRate = Number(body.hourlyRate);
  const deposit = Number(body.deposit);
  const capacity = Number(body.capacity);
  const image = String(body.image ?? "").trim();
  const gallery = clampStrings(body.gallery as string | string[]);
  const amenities = clampStrings(body.amenities as string | string[]);

  if (title.length < 3) throw new HttpError(400, "Studio title must be at least 3 characters.");
  if (!CATEGORIES.includes(category))
    throw new HttpError(400, "Please pick a studio category from the list.");
  if (!Number.isFinite(hourlyRate) || hourlyRate < 1 || hourlyRate > 10_000)
    throw new HttpError(400, "Hourly rate must be between $1 and $10,000.");
  if (!Number.isFinite(deposit) || deposit < 0 || deposit > 100_000)
    throw new HttpError(400, "Security deposit must be $0 or more.");
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500)
    throw new HttpError(400, "Max capacity must be at least 1 guest.");
  if (location.length < 4) throw new HttpError(400, "Please enter a location or address.");
  if (overview.length < 30)
    throw new HttpError(400, "The detailed overview must be at least 30 characters.");
  if (image && !httpUrl(image))
    throw new HttpError(400, "Image URL must start with http:// or https://");
  for (const u of gallery) {
    if (!httpUrl(u)) throw new HttpError(400, "Gallery image URLs must be valid http(s) URLs.");
  }
  if (amenities.length === 0)
    throw new HttpError(400, "Pick at least one amenity so creators know what's included.");

  const uniqueImages = [...new Set([image, ...gallery].filter(Boolean))];

  return {
    title,
    category,
    hourlyRate,
    deposit,
    capacity,
    location,
    image: image || uniqueImages[0] || "",
    gallery: uniqueImages.filter(Boolean),
    amenities,
    overview,
  };
}

studiosRouter.get(
  "/",
  wrap(async (req, res) => {
    const filters: Record<string, unknown> = {};

    const category = String(req.query.category ?? "").trim();
    if (category) {
      filters.category = { $regex: `^${escapeRegex(category)}$`, $options: "i" };
    }

    const q = String(req.query.q ?? "").trim();
    if (q) {
      const needle = new RegExp(escapeRegex(q), "i");
      filters.$or = [
        { title: { $regex: needle } },
        { location: { $regex: needle } },
        { category: { $regex: needle } },
      ];
    }

    const sortKey = (
      Object.keys(SORTS).includes(String(req.query.sort))
        ? String(req.query.sort)
        : "default"
    ) as SortKey;

    const requestedLimit = Number(req.query.limit);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 60)
      : 60;

    const studios = await getCollection<StudioDoc>("studios");
    const docs = await studios
      .find(filters)
      .sort(SORTS[sortKey])
      .limit(limit)
      .toArray();

    sendSuccess(res, { items: docs.map(serializeStudio) });
  })
);

studiosRouter.get(
  "/featured",
  wrap(async (req, res) => {
    const studios = await getCollection<StudioDoc>("studios");
    const docs = await studios
      .find({})
      .sort({ rating: -1, reviewsCount: -1, createdAt: -1 })
      .limit(6)
      .toArray();
    sendSuccess(res, { items: docs.map(serializeStudio) });
  })
);

studiosRouter.get(
  "/mine",
  requireAuth,
  wrap(async (req, res) => {
    const user = await authedUser(req.auth!);
    const studios = await getCollection<StudioDoc>("studios");
    const docs = await studios
      .find({ ownerEmail: user.email })
      .sort({ createdAt: -1 })
      .toArray();
    sendSuccess(res, { items: docs.map(serializeStudio) });
  })
);
studiosRouter.post(
  "/",
  requireAuth,
  wrap(async (req, res) => {
    const user = await authedUser(req.auth!);
    const input = parseStudioInput(req.body ?? {});

    const studios = await getCollection<StudioDoc>("studios");
    const doc: StudioDoc = {
      ...input,
      ownerName: user.name,
      ownerEmail: user.email,
      rating: 0,
      reviewsCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const inserted = await studios.insertOne(doc);
    const created =
      (await studios.findOne({ _id: inserted.insertedId })) ?? doc;

    res.status(201).json({
      success: true,
      message: "Studio listed successfully!",
      data: { studio: serializeStudio(created) },
    });
  })
);

async function ownStudioOr403(studioId: string, userEmail: string) {
  if (!ObjectId.isValid(studioId))
    throw new HttpError(400, "That studio id is not valid.");
  const studios = await getCollection<StudioDoc>("studios");
  const doc = await studios.findOne({ _id: new ObjectId(studioId) });
  if (!doc) throw new HttpError(404, "Studio not found. It may have been removed.");
  if (doc.ownerEmail.toLowerCase() !== userEmail.toLowerCase())
    throw new HttpError(
      403,
      "This listing belongs to another host — you can only manage your own studios."
    );
  return { studios, doc };
}

function parseStudioPatch(
  body: Record<string, unknown>,
  existing: WithId<StudioDoc>
): StudioInput {
  const merged: Record<string, unknown> = {
    title: body.title ?? existing.title,
    category: body.category ?? existing.category,
    hourlyRate: body.hourlyRate ?? existing.hourlyRate,
    deposit: body.deposit ?? existing.deposit,
    capacity: body.capacity ?? existing.capacity,
    location: body.location ?? existing.location,
    image: body.image ?? existing.image,
    gallery: body.gallery ?? existing.gallery,
    amenities: body.amenities ?? existing.amenities,
    overview: body.overview ?? existing.overview,
  };
  return parseStudioInput(merged);
}

const updateStudio = wrap(async (req, res) => {
  const { id } = req.params;
  const { studios, doc } = await ownStudioOr403(
    String(id ?? ""),
    req.auth!.email
  );
  const input =
    req.method === "PATCH"
      ? parseStudioPatch(req.body ?? {}, doc)
      : parseStudioInput(req.body ?? {});

  const updated: WithId<StudioDoc> = {
    ...((doc as unknown) as WithId<StudioDoc>),
    ...input,
    ownerName: doc.ownerName,
    ownerEmail: doc.ownerEmail,
    updatedAt: new Date(),
  };
  await studios.replaceOne({ _id: doc._id as never }, updated as never, {
    upsert: false,
  });

  sendSuccess(res, { studio: serializeStudio(updated) }, "Studio updated successfully!");
});
studiosRouter.put("/:id", requireAuth, updateStudio);
studiosRouter.patch("/:id", requireAuth, updateStudio);

studiosRouter.delete(
  "/:id",
  requireAuth,
  wrap(async (req, res) => {
    const { id } = req.params;
    const { studios, doc } = await ownStudioOr403(String(id ?? ""), req.auth!.email);

    const studioKey = String(doc._id);
    await Promise.all([
      studios.deleteOne({ _id: doc._id as never }),
      getCollection("bookings").then((b) =>
        b.deleteMany({ studioId: { $in: [doc._id as never, studioKey] } } as never)
      ),
      getCollection("reviews").then((r) =>
        r.deleteMany({ studioId: studioKey } as never)
      ),
    ]);

    sendSuccess(
      res,
      { deleted: true, id },
      `${doc.title} removed from your listings.`
    );
  })
);

studiosRouter.get(
  "/:id/availability",
  wrap(async (req, res) => {
    const id = String(req.params.id ?? "");
    if (!ObjectId.isValid(id))
      throw new HttpError(400, "That studio id is not valid.");

    const date = String(req.query.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new HttpError(400, "Please pass a valid date (?date=YYYY-MM-DD).");

    const bookings = await getCollection<BookingDoc>("bookings");
    const taken = await bookings
      .find({
        studioId: new ObjectId(id),
        date,
        status: { $in: ["Pending", "Confirmed"] as never },
      })
      .sort({ startTime: 1 })
      .toArray();

    sendSuccess(res, {
      date,
      slots: taken.map((b) => ({
        startTime: b.startTime,
        endTime: b.endTime,
        status: b.status,
      })),
    });
  })
);

studiosRouter.get(
  "/:id",
  wrap(async (req, res) => {
    const id = String(req.params.id ?? "");
    if (!ObjectId.isValid(id))
      throw new HttpError(400, "That studio id is not valid.");

    const studios = await getCollection<StudioDoc>("studios");
    const doc = (await studios.findOne({ _id: new ObjectId(id) })) as
      | WithId<StudioDoc>
      | null;
    if (!doc) throw new HttpError(404, "Studio not found. It may have been removed.");

    const reviews = await getCollection<ReviewDoc>("reviews");
    const studioReviews = await reviews
      .find({ studioId: id })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    sendSuccess(res, {
      studio: serializeStudio(doc),
      reviews: studioReviews.map(serializeReview),
    });
  })
);
