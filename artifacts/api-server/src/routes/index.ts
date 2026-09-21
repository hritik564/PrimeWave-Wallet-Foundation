import { Router, type IRouter } from "express";
import type { ServerConfig } from "../config";
import { createHealthRouter } from "./health";

export function createRouter(config: ServerConfig): IRouter {
  const router: IRouter = Router();
  router.use(createHealthRouter(config));
  return router;
}
