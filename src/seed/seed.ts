import { getDb } from "../db/mongo";
import { SEED_STUDIOS } from "./studios";

export async function seedStudios(verbose = true): Promise<number> {
  const db = await getDb();
  const studios = db.collection("studios");

  const deleteResult = await studios.deleteMany({});
  const inserted = await studios.insertMany(SEED_STUDIOS.map((s) => ({ ...s })));

  if (verbose) {
    console.log("─────────────────────────────────────────────────");
    console.log(
      `🌱 Seeded ${inserted.insertedCount} studios (${deleteResult.deletedCount} removed).`
    );
    for (const s of SEED_STUDIOS) {
      console.log(`   • [${s.category}] ${s.title} — $${s.hourlyRate}/hr — ${s.location}`);
    }
    console.log("─────────────────────────────────────────────────");
  }
  return inserted.insertedCount;
}
if (process.argv[1] && process.argv[1].includes("seed")) {
  seedStudios()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("❌ Seed failed:", error instanceof Error ? error.message : error);
      if (error instanceof Error && "code" in error && String(error.code) === "ECONNREFUSED") {
        console.error(
          "   MongoDB isn't reachable at MONGODB_URI. Start a local mongod, use an Atlas URI, or run `npm run dev:db` for an embedded database."
        );
      }
      process.exit(1);
    });
}
