import { Router } from "express";
import { ObjectId, type WithId } from "mongodb";
import { getCollection } from "../db/mongo";
import { requireAuth } from "../middleware/auth";
import { HttpError, sendSuccess, wrap } from "../utils/helpers";
import { authedUser } from "../utils/current-user";
import type { ReviewDoc, StudioDoc } from "../types";

export const reviewsRouter = Router();

const oidOf = (value: string) => {
  if (!ObjectId.isValid(value)) throw new HttpError(400, "That studio id is not valid.");
  return new ObjectId(value);
};

export const serializeReview = (doc: WithId<ReviewDoc>) => ({
  _id: doc._id.toString(),
  studioId: String(doc.studioId),
  userName: doc.userName,
  userEmail: doc.userEmail,
  rating: doc.rating,
  comment: doc.comment,
  createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : undefined,
});

reviewsRouter.get(
  "/studios/:id/reviews",
  wrap(async (req, res) => {
    const studioId = String(req.params.id ?? "");
    if (!ObjectId.isValid(studioId))
      throw new HttpError(400, "That studio id is not valid.");

    const reviews = await getCollection<ReviewDoc>("reviews");
    const docs = await reviews
      .find({ studioId })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    sendSuccess(res, { items: docs.map(serializeReview) });
  })
);

reviewsRouter.post(
  "/studios/:id/reviews",
  requireAuth,
  wrap(async (req, res) => {
    const studioId = String(req.params.id ?? "");
    if (!ObjectId.isValid(studioId))
      throw new HttpError(400, "That studio id is not valid.");

    const rating = Number(req.body?.rating);
    const comment = String(req.body?.comment ?? "").trim();

    if (!Number.isInteger(rating) || rating < 1 || rating > 5)
      throw new HttpError(400, "Rating must be a whole number from 1 to 5.");
    if (comment.length < 5)
      throw new HttpError(400, "Tell other creators a bit more (at least 5 characters).");
    if (comment.length > 600)
      throw new HttpError(400, "Reviews are capped at 600 characters.");

    const studios = await getCollection<StudioDoc>("studios");
    const studio = await studios.findOne({ _id: oidOf(studioId) });
    if (!studio) throw new HttpError(404, "Studio not found. It may have been removed.");

    const user = await authedUser(req.auth!);
    if (studio.ownerEmail.toLowerCase() === user.email)
      throw new HttpError(403, "You can't review your own listing.");

    const reviews = await getCollection<ReviewDoc>("reviews");
    const existing = await reviews.findOne({
      studioId,
      userEmail: user.email,
    });
    if (existing)
      throw new HttpError(
        409,
        "You already reviewed this studio — one review per studio per creator."
      );

    const doc: ReviewDoc = {
      studioId,
      userName: user.name,
      userEmail: user.email,
      rating,
      comment,
      createdAt: new Date(),
    };
    const inserted = await reviews.insertOne(doc);

    const pipeline = [
      { $match: { studioId } },
      {
        $group: {
          _id: null,
          avgRating: { $avg: "$rating" },
          reviewsCount: { $sum: 1 },
        },
      },
    ];
    const [aggregate] = await reviews.aggregate(pipeline).toArray();
    const stats = aggregate
      ? {
          rating: Math.round(aggregate.avgRating * 10) / 10,
          reviewsCount: aggregate.reviewsCount,
        }
      : { rating: 0, reviewsCount: 0 };

    await studios.updateOne(
      { _id: oidOf(studioId) },
      { $set: { ...stats, updatedAt: new Date() } }
    );

    sendSuccess(
      res,
      { items: [serializeReview({ ...doc, _id: inserted.insertedId })], ...stats },
      "Review posted — thanks for helping other creators!"
    );
  })
);
