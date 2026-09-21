import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import type { ServerConfig } from "../config";

export function createHealthRouter(config: ServerConfig): IRouter {
  const router: IRouter = Router();

  router.get("/healthz", (_req, res) => {
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.status(200).json(data);
  });

  router.get("/readyz", (_req, res) => {
    const databaseStatus = config.databaseUrl ? "configured" : "not_configured";
    const ready =
      config.environment !== "production" || databaseStatus === "configured";
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      checks: { database: databaseStatus },
    });
  });

  router.get("/version", (_req, res) => {
    res.json({ apiVersion: config.apiVersion, service: "wavex-api" });
  });

  return router;
}
