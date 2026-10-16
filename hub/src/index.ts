import { createHub } from "./server.js";

export * from "./db.js";
export * from "./socket-manager.js";
export * from "./server.js";

// If run directly from CLI
if (import.meta.main) {
  const port = Number(process.env.PORT || 8787);
  console.log(`Starting RenegadeBox Hub on port ${port}...`);
  const hub = await createHub({ port });
  console.log(`RenegadeBox Hub running at ws://localhost:${hub.port}`);

  const shutdown = async () => {
    console.log("Shutting down Hub...");
    await hub.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
