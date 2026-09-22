import { Router, type IRouter } from "express";
import type { ServerConfig } from "../config";
import { HttpError } from "../lib/errors";
import { validateQuery } from "../lib/request-validation";
import { MarketError } from "./errors";
import { createMarketPriceService, MarketPriceService } from "./service";
import { marketPriceQuerySchema } from "./validation";

function toHttpError(error: MarketError): HttpError {
  const status =
    error.code === "CONFIGURATION_ERROR" ? 503 :
    error.code === "RESPONSE_LIMIT" ? 413 : 400;
  return new HttpError(status, error.code, error.message);
}

export function createMarketPriceRouter(
  config: ServerConfig,
  service: MarketPriceService = createMarketPriceService(config),
): IRouter {
  const router: IRouter = Router();
  router.get(
    "/prices",
    validateQuery(marketPriceQuerySchema),
    async (request, response, next) => {
      try {
        const query = request.validatedQuery as {
          readonly assets: readonly string[];
          readonly quoteCurrency: string;
        };
        response.json({
          data: await service.getPrices({
            assetDescriptors: query.assets,
            quoteCurrency: query.quoteCurrency,
          }),
        });
      } catch (error) {
        next(error instanceof MarketError ? toHttpError(error) : error);
      }
    },
  );
  return router;
}