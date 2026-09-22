import { Router, type IRouter } from "express";
import type { ServerConfig } from "../config";
import { createHealthRouter } from "./health";
import { createMetadataRouter } from "../metadata/router";
import type { MetadataRepository } from "../metadata/types";
import { createIndexerRouter } from "../indexing/router";
import { IndexerService } from "../indexing/service";

export function createRouter(
  config: ServerConfig,
  repository?: MetadataRepository,
  indexer?: IndexerService,
): IRouter {
  const router: IRouter = Router();
  router.use(createHealthRouter(config));
  router.use(createMetadataRouter(config, repository));
  if (indexer) router.use(createIndexerRouter(indexer));
  return router;
}
