import { MongoClient, type Db, type Document } from "mongodb";
import { env } from "../config/env.js";

const cached = globalThis as unknown as {
  __studiospaceMongoClient?: MongoClient;
  __studiospaceDb?: Promise<Db>;
};

const client = cached.__studiospaceMongoClient ?? new MongoClient(env.mongoUri);
cached.__studiospaceMongoClient = client;

export function getDb(): Promise<Db> {
  cached.__studiospaceDb ??= client.connect().then(() => client.db(env.dbName));
  return cached.__studiospaceDb;
}

export async function getCollection<T extends Document>(name: string) {
  const db = await getDb();
  return db.collection<T>(name);
}
