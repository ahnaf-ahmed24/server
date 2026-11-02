import type { ObjectId, WithId } from "mongodb";
import type { StudioDoc, UserDoc } from "../types";


export interface PublicUser {
  name: string;
  email: string;
  photoURL: string;
  role?: string;
  joinedAt?: string;
}

export const oidToString = (id: ObjectId | string | undefined): string =>
  typeof id === "string" ? id : (id?.toString() ?? "");

export function serializeUser(doc: WithId<UserDoc> | UserDoc): PublicUser {
  return {
    name: doc.name,
    email: doc.email,
    photoURL: doc.photoURL ?? "",
    role: doc.role ?? "user",
    joinedAt: doc.joinedAt ? new Date(doc.joinedAt).toISOString() : undefined,
  };
}

export function serializeStudio(doc: WithId<StudioDoc> | StudioDoc) {
  return {
    _id: oidToString(doc._id),
    title: doc.title,
    category: doc.category,
    hourlyRate: doc.hourlyRate,
    deposit: doc.deposit,
    capacity: doc.capacity,
    location: doc.location,
    image: doc.image,
    gallery: doc.gallery ?? [],
    amenities: doc.amenities,
    overview: doc.overview,
    ownerName: doc.ownerName,
    ownerEmail: doc.ownerEmail,
    rating: doc.rating,
    reviewsCount: doc.reviewsCount,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : undefined,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : undefined,
  };
}
