import { Router, type IRouter } from "express";
import { z } from "zod";
import type { ServerConfig } from "../config";
import { HttpError } from "../lib/errors";
import { validateBody, validateParams, validateQuery } from "../lib/request-validation";
import { NotificationError } from "./errors";
import { createNotificationRepository } from "./repository";
import { NotificationService } from "./service";
import {
  notificationDeviceBodySchema,
  notificationPreferencesSchema,
  notificationRegistrationParamsSchema,
  notificationScopeSchema,
  notificationScopeQuerySchema,
} from "./validation";
import type { NotificationRepository } from "./types";

function toHttpError(error: unknown): HttpError {
  if (!(error instanceof NotificationError)) {
    return new HttpError(
      500,
      "INTERNAL_ERROR",
      "The notification request could not be completed.",
    );
  }
  const status =
    error.code === "DEVICE_NOT_FOUND"
      ? 404
      : error.code === "DEVICE_LIMIT" || error.code === "QUEUE_LIMIT"
        ? 429
        : error.code === "PERSISTENCE_FAILURE"
          ? 503
          : 400;
  return new HttpError(status, error.code, error.message);
}

const preferencesBodySchema = notificationScopeSchema
  .extend(notificationPreferencesSchema.shape)
  .strict();

export function createNotificationRouter(
  config: ServerConfig,
  repository: NotificationRepository = createNotificationRepository(config),
  service = new NotificationService(config.notifications, repository),
): IRouter {
  const router: IRouter = Router();

  router.post(
    "/notifications/devices",
    validateBody(notificationDeviceBodySchema),
    async (request, response, next) => {
      try {
        response.status(201).json({
          data: await service.registerDevice(request.validatedBody as z.infer<
            typeof notificationDeviceBodySchema
          >),
        });
      } catch (error) {
        next(error instanceof NotificationError ? toHttpError(error) : error);
      }
    },
  );

  router.delete(
    "/notifications/devices/:registrationId",
    validateParams(notificationRegistrationParamsSchema),
    validateQuery(notificationScopeQuerySchema),
    async (request, response, next) => {
      try {
        const params = request.validatedParams as z.infer<
          typeof notificationRegistrationParamsSchema
        >;
        const scope = request.validatedQuery as z.infer<
          typeof notificationScopeQuerySchema
        >;
        await service.unregisterDevice(scope, params.registrationId);
        response.json({
          data: { registrationId: params.registrationId, disabled: true },
        });
      } catch (error) {
        next(error instanceof NotificationError ? toHttpError(error) : error);
      }
    },
  );

  router.get(
    "/notifications/preferences",
    validateQuery(notificationScopeQuerySchema),
    async (request, response, next) => {
      try {
        const scope = request.validatedQuery as z.infer<
          typeof notificationScopeQuerySchema
        >;
        response.json({
          data: NotificationService.publicPreferences(
            await service.getPreferences(scope),
          ),
        });
      } catch (error) {
        next(error instanceof NotificationError ? toHttpError(error) : error);
      }
    },
  );

  router.put(
    "/notifications/preferences",
    validateBody(preferencesBodySchema),
    async (request, response, next) => {
      try {
        const body = request.validatedBody as z.infer<
          typeof preferencesBodySchema
        >;
        const { networkId, chainId, accountAddress, ...preferences } = body;
        response.json({
          data: NotificationService.publicPreferences(
            await service.updatePreferences(
              { networkId, chainId, accountAddress },
              preferences,
            ),
          ),
        });
      } catch (error) {
        next(error instanceof NotificationError ? toHttpError(error) : error);
      }
    },
  );

  return router;
}