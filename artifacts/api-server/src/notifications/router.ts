import { Router, type IRouter } from "express";
import { z } from "zod";
import type { ServerConfig } from "../config";
import { HttpError } from "../lib/errors";
import { validateBody, validateParams, validateQuery } from "../lib/request-validation";
import {
  authorizedAccountScope,
  createFailClosedAccountAuthorizationBoundary,
  requireAccountAuthorization,
  type AccountAuthorizationBoundary,
} from "../lib/auth-boundary";
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
  accountAuthorization: AccountAuthorizationBoundary =
    createFailClosedAccountAuthorizationBoundary(),
): IRouter {
  const router: IRouter = Router();

  router.post(
    "/notifications/devices",
    validateBody(notificationDeviceBodySchema),
    requireAccountAuthorization(accountAuthorization, (request) => {
      const body = request.validatedBody as z.infer<
        typeof notificationDeviceBodySchema
      >;
      return {
        networkId: body.networkId,
        chainId: body.chainId,
        accountAddress: body.accountAddress,
      };
    }),
    async (request, response, next) => {
      try {
        const body = request.validatedBody as z.infer<
          typeof notificationDeviceBodySchema
        >;
        response.status(201).json({
          data: await service.registerDevice({
            ...body,
            ...authorizedAccountScope(request),
          }),
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
    requireAccountAuthorization(accountAuthorization, (request) => {
      const scope = request.validatedQuery as z.infer<
        typeof notificationScopeQuerySchema
      >;
      return scope;
    }),
    async (request, response, next) => {
      try {
        const params = request.validatedParams as z.infer<
          typeof notificationRegistrationParamsSchema
        >;
        await service.unregisterDevice(
          authorizedAccountScope(request),
          params.registrationId,
        );
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
    requireAccountAuthorization(accountAuthorization, (request) =>
      request.validatedQuery as z.infer<typeof notificationScopeQuerySchema>,
    ),
    async (request, response, next) => {
      try {
        response.json({
          data: NotificationService.publicPreferences(
            await service.getPreferences(authorizedAccountScope(request)),
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
    requireAccountAuthorization(accountAuthorization, (request) => {
      const body = request.validatedBody as z.infer<
        typeof preferencesBodySchema
      >;
      return {
        networkId: body.networkId,
        chainId: body.chainId,
        accountAddress: body.accountAddress,
      };
    }),
    async (request, response, next) => {
      try {
        const body = request.validatedBody as z.infer<
          typeof preferencesBodySchema
        >;
        const { networkId: _networkId, chainId: _chainId, accountAddress: _accountAddress, ...preferences } = body;
        response.json({
          data: NotificationService.publicPreferences(
            await service.updatePreferences(
              authorizedAccountScope(request),
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