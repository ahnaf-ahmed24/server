import { Router } from "express";
import { ObjectId, type WithId } from "mongodb";
import { getCollection } from "../db/mongo";
import { requireAuth } from "../middleware/auth";
import { HttpError, sendSuccess, wrap } from "../utils/helpers";
import { serializeStudio } from "../utils/serialize";
import type { StudioDoc, WishlistDoc } from "../types";

export const wishlistRouter = Router();

wishlistRouter.use(requireAuth);

const serializeItem = (doc: WithId<WishlistDoc>) => ({
  _id: oidOf(doc),
  userEmail: doc.userEmail,
  studioId: doc.studioId,
  studio: serializeStudio({
    _id: new ObjectId(doc.studioId),
    ...doc.studio,
  } as WithId<StudioDoc>),
  createdAt: new Date(doc.createdAt).toISOString(),
});

const oidOf = (doc: WithId<WishlistDoc>) =>
  doc._id ? doc._id.toString() : doc.studioId;
wishlistRouter.get(
  "/",
  wrap(async (req, res) => {
    const wishlist = await getCollection<WishlistDoc>("wishlist");
    const userEmail = req.auth!.email.toLowerCase();
    const docs = await wishlist
      .find({ userEmail })
      .sort({ createdAt: -1 })
      .toArray();

    const studios = await getCollection<StudioDoc>("studios");
    const objectIds = docs
      .map((d) => (ObjectId.isValid(d.studioId) ? new ObjectId(d.studioId) : null))
      .filter((id): id is ObjectId => id !== null);
    const live = objectIds.length
      ? await studios.find({ _id: { $in: objectIds as never } }).toArray()
      : [];
    const liveIds = new Set(live.map((s) => String(s._id)));

    const stale = docs.filter((d) => !liveIds.has(d.studioId));
    if (stale.length > 0) {
      await wishlist.deleteMany({
        userEmail,
        studioId: { $in: stale.map((d) => d.studioId) } as never,
      });
    }

    const kept = docs.filter((d) => liveIds.has(d.studioId));
    sendSuccess(res, { items: kept.map(serializeItem) });
  })
);

wishlistRouter.post(
  "/",
  wrap(async (req, res) => {
    const studioId = String(req.body?.studioId ?? "");
    if (!ObjectId.isValid(studioId))
      throw new HttpError(400, "That studio id is not valid.");

    const studios = await getCollection<StudioDoc>("studios");
    const studio = await studios.findOne({ _id: new ObjectId(studioId) });
    if (!studio) throw new HttpError(404, "That studio no longer exists.");

    const wishlist = await getCollection<WishlistDoc>("wishlist");
    const userEmail = req.auth!.email.toLowerCase();

    const existing = await wishlist.findOne({ userEmail, studioId });
    if (existing) {
      sendSuccess(res, { added: false, items: [] }, "Already in your wishlist.");
      return;
    }

    await wishlist.insertOne({
      userEmail,
      studioId,
      studio: { ...studio, _id: studio._id } as never,
      createdAt: new Date(),
    });

    sendSuccess(res, { added: true, items: [] }, "Saved to your wishlist.");
  })
);

wishlistRouter.delete(
  "/:studioId",
  wrap(async (req, res) => {
    const studioId = String(req.params.studioId ?? "");
    if (!ObjectId.isValid(studioId))
      throw new HttpError(400, "That studio id is not valid.");

    const wishlist = await getCollection<WishlistDoc>("wishlist");
    const result = await wishlist.deleteOne({
      userEmail: req.auth!.email.toLowerCase(),
      studioId,
    });

    sendSuccess(
      res,
      { removed: result.deletedCount > 0, items: [] },
      "Removed from your wishlist."
    );
  })
);
