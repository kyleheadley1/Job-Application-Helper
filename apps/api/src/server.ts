import { app } from "./app.js";
import { env } from "./config/env.js";
import { closeDb, getDb } from "./config/mongo.js";
import { logger } from "./lib/logger.js";

const start = async (): Promise<void> => {
  await getDb();
  const server = app.listen(env.port, () => {
    logger.info("API server started", { port: env.port, env: env.nodeEnv });
  });

  const shutdown = async () => {
    server.close();
    await closeDb();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

start().catch((error) => {
  logger.error("API server failed to start", { message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
