import express, { type Express } from "express";
import cors, { type CorsOptions } from "cors";
import pinoHttp from "pino-http";
import { loadConfig, type ServerConfig } from "./config";
import { errorHandler, HttpError } from "./lib/errors";
import { logger } from "./lib/logger";
import { MemoryRateLimiter, rateLimitMiddleware } from "./lib/rate-limit";
import { requireJsonContentType, requestIdMiddleware } from "./lib/request-validation";
import { secretMaterialGuard, securityHeaders } from "./lib/security";
import { createRouter } from "./routes";
import type { MetadataRepository } from "./metadata/types";
import { createMetadataRepository } from "./metadata/repository";
import { createIndexerRepository } from "./indexing/repository";
import { IndexerService } from "./indexing/service";
import type { NotificationRepository } from "./notifications/types";
import type { AnalyticsProvider, AnalyticsRepository } from "./analytics/types";

export function createApp(
  config: ServerConfig = loadConfig(),
  repository?: MetadataRepository,
  notificationRepository?: NotificationRepository,
  analyticsRepository?: AnalyticsRepository,
  analyticsProvider?: AnalyticsProvider,
): Express {
  const app: Express = express();
  const metadataRepository = repository ?? createMetadataRepository(config);
  const indexerService = new IndexerService(
    config.indexer,
    createIndexerRepository(config),
  );
  const rateLimiter = new MemoryRateLimiter(
    config.rateLimitWindowMs,
    config.rateLimitMaxRequests,
  );
  const corsOptions: CorsOptions = {
    credentials: false,
    methods: ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"],
    origin: (origin, callback) => {
      if (!origin || config.corsAllowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  };

  app.use(securityHeaders);
  app.use(requestIdMiddleware);
  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );
  app.use(cors(corsOptions));
  app.use(requireJsonContentType);
  app.use(express.json({ limit: config.requestBodyLimit }));
  app.use(rateLimitMiddleware(rateLimiter));
  app.use(secretMaterialGuard);

  // Keep the existing workflow startup probe working while the versioned
  // namespace becomes the only new API boundary.
  app.use(
    `${config.apiPrefix}`,
    createRouter(
      config,
      metadataRepository,
      indexerService,
      notificationRepository,
      analyticsRepository,
      analyticsProvider,
    ),
  );
  app.use(
    "/api",
    createRouter(
      config,
      metadataRepository,
      indexerService,
      notificationRepository,
      analyticsRepository,
      analyticsProvider,
    ),
  );
  app.use((_request, _response, next) => {
    next(new HttpError(404, "NOT_FOUND", "The requested API resource was not found."));
  });
  app.use(errorHandler);

  return app;
}

export default createApp();
