import { MongoClient, type Db, type Document } from "mongodb";
import { env } from "../config/env";

const client = new MongoClient(env.mongoUri);
let dbPromise: Promise<Db> | null = null;


export function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = client.connect().then(() => client.db(env.dbName));
  }
  return dbPromise;
}

export async function getCollection<T extends Document>(name: string) {
  const db = await getDb();
  return db.collection<T>(name);
}
