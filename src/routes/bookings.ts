import { Router } from "express";
import { ObjectId, type WithId } from "mongodb";
import { getCollection } from "../db/mongo";
import { requireAuth } from "../middleware/auth";
import { HttpError, sendSuccess, wrap } from "../utils/helpers";
import { authedUser } from "../utils/current-user";
import type { BookingDoc, BookingStatus, StudioDoc } from "../types";

export const bookingsRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const STATUS_META: Record<BookingStatus, { badge: string }> = {
  Pending: { badge: "badge-warning" },
  Confirmed: { badge: "badge-success" },
  Completed: { badge: "badge-info" },
  Cancelled: { badge: "badge-error" },
};

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const timeOf = (mins: number) =>
  `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

const serializeBooking = (doc: WithId<BookingDoc>) => ({
  ...doc,
  _id: doc._id.toString(),
  studioId: String(doc.studioId),
  createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : undefined,
  updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : undefined,
});

bookingsRouter.post(
  "/",
  requireAuth,
  wrap(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const studioId = String(body.studioId ?? "");
    const date = String(body.date ?? "");
    const startTime = String(body.startTime ?? "");
    const hours = Number(body.hours);

    if (!ObjectId.isValid(studioId))
      throw new HttpError(400, "That studio id is not valid.");
    if (!DATE_RE.test(date))
      throw new HttpError(400, "Please pick a valid booking date.");
    if (!TIME_RE.test(startTime))
      throw new HttpError(400, "Please pick a valid start time.");
    if (!Number.isInteger(hours) || hours < 1 || hours > 12)
      throw new HttpError(400, "Shoot length must be between 1 and 12 hours.");

    const today = new Date().toISOString().slice(0, 10);
    if (date < today)
      throw new HttpError(400, "You cannot book a date in the past.");

    const startMin = minutesOf(startTime);
    const endMin = startMin + hours * 60;
    if (endMin > 24 * 60)
      throw new HttpError(400, "Bookings must finish within the same day.");
    const endTime = timeOf(endMin);

    const studios = await getCollection<StudioDoc>("studios");
    const studio = await studios.findOne({ _id: new ObjectId(studioId) });
    if (!studio) throw new HttpError(404, "Studio not found. It may have been removed.");

    const user = await authedUser(req.auth!);
    if (studio.ownerEmail.toLowerCase() === user.email)
      throw new HttpError(
        400,
        "This is your own listing — no need to book your own studio."
      );

    const bookings = await getCollection<BookingDoc>("bookings");

    const overlapping = await bookings.countDocuments({
      studioId: studio._id,
      date,
      status: { $in: ["Pending", "Confirmed"] as never },
      startTime: { $lt: endTime },
      endTime: { $gt: startTime },
    });
    if (overlapping > 0)
      throw new HttpError(
        409,
        "That time slot is already reserved (confirmed or pending). Pick different hours or another date."
      );

    const doc: BookingDoc = {
      studioId: studio._id!,
      studioTitle: studio.title,
      studioImage: studio.image,
      studioCategory: studio.category,
      hourlyRate: studio.hourlyRate,
      deposit: studio.deposit,
      hours,
      date,
      startTime,
      endTime,
      total: Math.round(studio.hourlyRate * hours + studio.deposit),
      status: "Pending",
      userEmail: user.email,
      userName: user.name,
      ownerEmail: studio.ownerEmail,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const inserted = await bookings.insertOne(doc);
    const saved =
      (await bookings.findOne({ _id: inserted.insertedId })) ?? doc;

    sendSuccess(
      res,
      { booking: serializeBooking(saved as WithId<BookingDoc>) },
      "Booking requested — waiting for the host to confirm.",
      201
    );
  })
);


bookingsRouter.get(
  "/mine",
  requireAuth,
  wrap(async (req, res) => {
    const user = await authedUser(req.auth!);
    const bookings = await getCollection<BookingDoc>("bookings");
    const docs = await bookings
      .find({ userEmail: user.email })
      .sort({ createdAt: -1 })
      .toArray();
    sendSuccess(res, { items: docs.map(serializeBooking) });
  })
);

const incomingForHost = wrap(async (req, res) => {
  const user = await authedUser(req.auth!);
  const bookings = await getCollection<BookingDoc>("bookings");
  const docs = await bookings
    .find({ ownerEmail: user.email })
    .sort({ createdAt: -1 })
    .toArray();
  sendSuccess(res, { items: docs.map(serializeBooking) });
});
bookingsRouter.get("/manage", requireAuth, incomingForHost);
bookingsRouter.get("/incoming", requireAuth, incomingForHost);

const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  Pending: ["Confirmed", "Cancelled"],
  Confirmed: ["Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
};

bookingsRouter.patch(
  "/:id/status",
  requireAuth,
  wrap(async (req, res) => {
    const id = String(req.params.id ?? "");
    if (!ObjectId.isValid(id)) throw new HttpError(400, "That booking id is not valid.");

    const nextStatus = String(req.body?.status ?? "") as BookingStatus;
    if (!Object.keys(STATUS_META).includes(nextStatus))
      throw new HttpError(400, "Unknown booking status.");

    const user = await authedUser(req.auth!);
    const bookings = await getCollection<BookingDoc>("bookings");
    const doc = (await bookings.findOne({ _id: new ObjectId(id) })) as
      | WithId<BookingDoc>
      | null;
    if (!doc) throw new HttpError(404, "That booking no longer exists.");

    const isHost = doc.ownerEmail.toLowerCase() === user.email;
    const isOwner = doc.userEmail.toLowerCase() === user.email;
    if (!isHost && !isOwner)
      throw new HttpError(403, "You are not involved in this booking.");

    if (isOwner && !isHost) {
      if (nextStatus !== "Cancelled")
        throw new HttpError(403, "You can only cancel your own booking.");
      if (doc.status !== "Pending")
        throw new HttpError(
          409,
          "Only Pending bookings can be cancelled — this one is already " +
            doc.status.toLowerCase() + "."
        );
    }
    if (!TRANSITIONS[doc.status].includes(nextStatus))
      throw new HttpError(
        400,
        `A booking that is ${doc.status.toLowerCase()} cannot become ${nextStatus.toLowerCase()}.`
      );

    if (nextStatus === "Confirmed") {
      const conflicting = await bookings.countDocuments({
        _id: { $ne: doc._id as never },
        studioId: doc.studioId,
        date: doc.date,
        status: "Confirmed",
        startTime: { $lt: doc.endTime },
        endTime: { $gt: doc.startTime },
      });
      if (conflicting > 0)
        throw new HttpError(
          409,
          "Another Confirmed booking now overlaps this slot — cancel it instead."
        );
    }

    await bookings.updateOne(
      { _id: doc._id as never },
      { $set: { status: nextStatus, updatedAt: new Date() } }
    );

    const messages: Record<BookingStatus, string> = {
      Pending: "Booking kept pending.",
      Confirmed: "Booking confirmed! The studio is reserved for those hours.",
      Completed: "Booking marked as completed.",
      Cancelled: "Booking cancelled.",
    };

    const updated = (await bookings.findOne({ _id: doc._id as never })) as
      | WithId<BookingDoc>
      | null;
    sendSuccess(
      res,
      {
        status: nextStatus,
        booking: updated ? serializeBooking(updated) : null,
      },
      messages[nextStatus]
    );
  })
);

bookingsRouter.delete(
  "/:id",
  requireAuth,
  wrap(async (req, res) => {
    const id = String(req.params.id ?? "");
    if (!ObjectId.isValid(id)) throw new HttpError(400, "That booking id is not valid.");

    const user = await authedUser(req.auth!);
    const bookings = await getCollection<BookingDoc>("bookings");
    const doc = (await bookings.findOne({ _id: new ObjectId(id) })) as
      | WithId<BookingDoc>
      | null;
    if (!doc) throw new HttpError(404, "That booking no longer exists.");

    const isHost = doc.ownerEmail.toLowerCase() === user.email;
    const isOwner = doc.userEmail.toLowerCase() === user.email;
    if (!isHost && !isOwner)
      throw new HttpError(403, "You are not involved in this booking.");

    if (doc.status === "Completed" || doc.status === "Cancelled")
      throw new HttpError(
        409,
        `This booking is already ${doc.status.toLowerCase()} — its status is locked.`
      );
    if (!isHost && doc.status !== "Pending")
      throw new HttpError(
        409,
        "Only Pending bookings can be cancelled — this one is already " +
          doc.status.toLowerCase() + "."
      );

    await bookings.updateOne(
      { _id: doc._id as never },
      { $set: { status: "Cancelled", updatedAt: new Date() } }
    );

    const updated = (await bookings.findOne({ _id: doc._id as never })) as
      | WithId<BookingDoc>
      | null;
    sendSuccess(
      res,
      { booking: updated ? serializeBooking(updated) : null },
      "Booking cancelled."
    );
  })
);

bookingsRouter.get(
  "/:id",
  requireAuth,
  wrap(async (req, res) => {
    const id = String(req.params.id ?? "");
    if (!ObjectId.isValid(id)) throw new HttpError(400, "That booking id is not valid.");

    const user = await authedUser(req.auth!);
    const bookings = await getCollection<BookingDoc>("bookings");
    const doc = (await bookings.findOne({ _id: new ObjectId(id) })) as
      | WithId<BookingDoc>
      | null;
    if (!doc) throw new HttpError(404, "That booking no longer exists.");
    if (
      doc.userEmail.toLowerCase() !== user.email &&
      doc.ownerEmail.toLowerCase() !== user.email
    )
      throw new HttpError(403, "You are not involved in this booking.");

    sendSuccess(res, { booking: serializeBooking(doc) });
  })
);
