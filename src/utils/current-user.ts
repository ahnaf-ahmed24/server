import { ObjectId, type WithId } from "mongodb";
import { getCollection } from "../db/mongo.js";
import { HttpError } from "./helpers.js";
import type { AuthPayload, UserDoc } from "../types.js";

export async function authedUser(auth: AuthPayload): Promise<WithId<UserDoc>> {
  const users = await getCollection<UserDoc>("users");
  const matchers: Record<string, unknown>[] = [{ email: auth.email }];
  if (auth.id && ObjectId.isValid(auth.id))
    matchers.push({ _id: new ObjectId(auth.id) });

  const doc = await users.findOne({ $or: matchers } as never);
  if (!doc) throw new HttpError(401, "Please log in again.");
  return doc;
}
