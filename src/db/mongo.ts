import { MongoClient, type Db, type Document } from "mongodb";
import { env } from "../config/env";

/**
 * Serverless runtimes (Vercel) may re-instantiate the module registry across
 * warm invocations of the same lambda instance. Cache the client and the
 * connection promise on globalThis so the pooled connection is reused —
 * otherwise every cold/warm start would open new Atlas connections.
 */
const cached = globalThis as unknown as {
  __studiospaceMongoClient?: MongoClient;
  __studiospaceDb?: Promise<Db>;
};

const client = cached.__studiospaceMongoClient ?? new MongoClient(env.mongoUri);
cached.__studiospaceMongoClient = client;

/** Shared Mongo connection — connects lazily on first call. */
export function getDb(): Promise<Db> {
  cached.__studiospaceDb ??= client.connect().then(() => client.db(env.dbName));
  return cached.__studiospaceDb;
}

export async function getCollection<T extends Document>(name: string) {
  const db = await getDb();
  return db.collection<T>(name);
}
