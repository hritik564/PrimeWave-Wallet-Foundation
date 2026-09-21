import app from "./app";
import { loadConfig } from "./config";
import { logger } from "./lib/logger";

const config = loadConfig();

app.listen(config.port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info(
    { port: config.port, environment: config.environment },
    "Server listening",
  );
});
