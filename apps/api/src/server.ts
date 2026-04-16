import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";

app.listen(env.port, () => {
  logger.info("API server started", { port: env.port, env: env.nodeEnv });
});
