import { Router, type IRouter } from "express";
import type { ServerConfig } from "../config";
import { createHealthRouter } from "./health";
import { createMetadataRouter } from "../metadata/router";
import type { MetadataRepository } from "../metadata/types";
import { createIndexerRouter } from "../indexing/router";
import { IndexerService } from "../indexing/service";
import { createSynchronizationRouter } from "../synchronization/router";
import { createMarketPriceRouter } from "../market/router";
import { createNotificationRouter } from "../notifications/router";
import type { NotificationRepository } from "../notifications/types";

export function createRouter(
  config: ServerConfig,
  repository?: MetadataRepository,
  indexer?: IndexerService,
  notificationRepository?: NotificationRepository,
): IRouter {
  const router: IRouter = Router();
  router.use(createHealthRouter(config));
  router.use(createMetadataRouter(config, repository));
  if (indexer) router.use(createIndexerRouter(indexer));
  router.use(createSynchronizationRouter(config));
  router.use(createMarketPriceRouter(config));
  router.use(createNotificationRouter(config, notificationRepository));
  return router;
}
