import type { ObjectId } from "mongodb";

export type BookingStatus = "Pending" | "Confirmed" | "Completed" | "Cancelled";

export interface UserDoc {
  _id?: ObjectId;
  name: string;
  email: string;
  photoURL?: string;
  password?: string | null;
  provider?: "credentials" | "google" | "github";
  role?: "user" | "admin";
  joinedAt?: Date;
}

export interface StudioDoc {
  _id?: ObjectId;
  title: string;
  category: string;
  hourlyRate: number;
  deposit: number;
  capacity: number;
  location: string;
  image: string;
  gallery?: string[];
  amenities: string[];
  overview: string;
  ownerName: string;
  ownerEmail: string;
  rating: number;
  reviewsCount: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface BookingDoc {
  _id?: ObjectId;
  studioId: ObjectId | string;
  studioTitle: string;
  studioImage: string;
  studioCategory?: string;
  hourlyRate: number;
  deposit: number;
  hours: number;
  date: string; 
  startTime: string; 
  endTime: string; 
  total: number;
  status: BookingStatus;
  userEmail: string;
  userName: string;
  ownerEmail: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ReviewDoc {
  _id?: ObjectId;
  studioId: string;
  userName: string;
  userEmail: string;
  rating: number;
  comment: string;
  createdAt?: Date;
}

export interface WishlistDoc {
  _id?: ObjectId;
  userEmail: string;
  studioId: string;
  studio: Omit<StudioDoc, "_id">;
  createdAt: Date;
}

export interface AuthPayload {
  email: string;
  name: string;
  id?: string;
}

export interface AuthedRequestData {
  auth?: AuthPayload;
}
