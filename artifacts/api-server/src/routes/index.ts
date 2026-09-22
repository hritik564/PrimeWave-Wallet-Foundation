import { Router, type IRouter } from "express";
import type { ServerConfig } from "../config";
import { createHealthRouter } from "./health";
import { createMetadataRouter } from "../metadata/router";
import type { MetadataRepository } from "../metadata/types";

export function createRouter(
  config: ServerConfig,
  repository?: MetadataRepository,
): IRouter {
  const router: IRouter = Router();
  router.use(createHealthRouter(config));
  router.use(createMetadataRouter(config, repository));
  return router;
}
