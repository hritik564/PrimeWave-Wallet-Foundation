import { Router, type IRouter } from "express";
import { IndexerService } from "./service";

export function createIndexerRouter(
  service: IndexerService,
): IRouter {
  const router: IRouter = Router();

  router.get("/indexing/status", async (_request, response, next) => {
    try {
      response.json({ data: await service.getStatus() });
    } catch (error) {
      next(error);
    }
  });

  return router;
}