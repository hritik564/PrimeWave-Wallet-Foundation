import { Router, type IRouter } from "express";
import { z } from "zod";
import type { ServerConfig } from "../config";
import { HttpError } from "../lib/errors";
import { validateBody } from "../lib/request-validation";
import { AnalyticsRequestError } from "./errors";
import { createAnalyticsRepository } from "./repository";
import { AnalyticsService } from "./service";
import type { AnalyticsProvider, AnalyticsRepository } from "./types";
import { analyticsEventSchema } from "./validation";

function toHttpError(error: unknown): HttpError {
  if (!(error instanceof AnalyticsRequestError)) {
    return new HttpError(
      500,
      "INTERNAL_ERROR",
      "The analytics request could not be completed.",
    );
  }
  const status =
    error.code === "PAYLOAD_TOO_LARGE" || error.code === "BATCH_LIMIT"
      ? 413
      : error.code === "PERSISTENCE_FAILURE"
        ? 503
        : error.code === "DISABLED"
          ? 503
          : 400;
  return new HttpError(status, error.code, error.message);
}

export function createAnalyticsRouter(
  config: ServerConfig,
  repository: AnalyticsRepository = createAnalyticsRepository(config),
  provider?: AnalyticsProvider,
  service = new AnalyticsService(config.analytics, repository, provider),
): IRouter {
  const router: IRouter = Router();
  const batchSchema = z
    .object({
      events: z
        .array(analyticsEventSchema)
        .min(1)
        .max(config.analytics.maxBatchEvents),
    })
    .strict();

  const assertPayloadSize = (value: unknown): void => {
    if (
      Buffer.byteLength(JSON.stringify(value), "utf8") >
      config.analytics.maxEventPayloadBytes
    ) {
      throw new AnalyticsRequestError(
        "PAYLOAD_TOO_LARGE",
        "The analytics payload is too large.",
      );
    }
  };

  router.post(
    "/analytics/events",
    validateBody(analyticsEventSchema),
    async (request, response, next) => {
      try {
        assertPayloadSize(request.validatedBody);
        const result = await service.ingestEvent(
          request.validatedBody as z.infer<typeof analyticsEventSchema>,
        );
        response.status(result.accepted ? 202 : 503).json({
          data: { accepted: result.accepted },
        });
      } catch (error) {
        next(error instanceof AnalyticsRequestError ? toHttpError(error) : error);
      }
    },
  );

  router.post(
    "/analytics/events/batch",
    validateBody(batchSchema),
    async (request, response, next) => {
      try {
        assertPayloadSize(request.validatedBody);
        const body = request.validatedBody as z.infer<typeof batchSchema>;
        const result = await service.ingestBatch(body.events);
        response.status(202).json({
          data: {
            accepted: result.accepted,
            rejected: result.rejected,
          },
        });
      } catch (error) {
        next(error instanceof AnalyticsRequestError ? toHttpError(error) : error);
      }
    },
  );

  return router;
}