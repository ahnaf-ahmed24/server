export {};

async function main() {
  const { MongoMemoryServer } = await import("mongodb-memory-server");

  const requestedPort = (() => {
    const flagIndex = process.argv.indexOf("--port");
    if (flagIndex !== -1 && process.argv[flagIndex + 1])
      return Number(process.argv[flagIndex + 1]);
    return 50999;
  })();

  const mongod = await MongoMemoryServer.create({
    instance: { port: requestedPort, dbName: "studiospace" },
  });
  const uri = mongod.getUri().replace(/\/$/, "");

  process.env.MONGODB_URI = uri;
  const { seedStudios } = await import("../seed/seed.js");
  await seedStudios();

  console.log("─────────────────────────────────────────────────");
  console.log("🗄️  Embedded MongoDB running (in-memory, dev only)");
  console.log(`   URI → ${uri}`);
  console.log("   Start the API against it:");
  console.log(`   PORT=5000 MONGODB_URI=${uri} npm run dev`);
  console.log("   Press Ctrl+C to stop.");
  console.log("─────────────────────────────────────────────────");

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await mongod.stop().catch(() => null);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("❌ Embedded database failed to start:", error);
  process.exit(1);
});
