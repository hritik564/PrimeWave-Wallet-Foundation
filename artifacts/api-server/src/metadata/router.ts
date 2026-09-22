import { Router, type IRouter } from "express";
import type { ServerConfig } from "../config";
import { validateParams, validateQuery } from "../lib/request-validation";
import { createPublicNetworkCatalog } from "./catalog";
import { createMetadataRepository } from "./repository";
import type { MetadataRepository } from "./types";
import { MetadataService } from "./service";
import {
  tokenBatchQuerySchema,
  tokenParamsSchema,
} from "./validation";

export function createMetadataRouter(
  config: ServerConfig,
  repository: MetadataRepository = createMetadataRepository(config),
): IRouter {
  const router: IRouter = Router();
  const service = new MetadataService(
    repository,
    createPublicNetworkCatalog(config),
  );

  router.get("/metadata/networks", async (_request, response, next) => {
    try {
      response.json({ data: await service.listNetworks() });
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/metadata/tokens/:networkId/:contractAddress",
    validateParams(tokenParamsSchema),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.getToken(
            (request.validatedParams as {
              networkId: string;
              contractAddress: string;
            }).networkId,
            (request.validatedParams as {
              networkId: string;
              contractAddress: string;
            }).contractAddress,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/metadata/tokens",
    validateQuery(tokenBatchQuerySchema),
    async (request, response, next) => {
      try {
        const query = request.validatedQuery as {
          networkId: string;
          addresses: string[];
        };
        const data = await service.listTokens(query.networkId, query.addresses);
        response.json({
          data,
          count: data.length,
          requested: query.addresses.length,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}