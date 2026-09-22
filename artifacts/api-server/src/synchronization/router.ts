import { Router, type IRouter } from "express";
import { z } from "zod";
import type { ServerConfig } from "../config";
import { HttpError } from "../lib/errors";
import { validateBody, validateQuery } from "../lib/request-validation";
import {
  authorizedAccountScope,
  createFailClosedAccountAuthorizationBoundary,
  requireAccountAuthorization,
  type AccountAuthorizationBoundary,
} from "../lib/auth-boundary";
import { createSynchronizationRepository } from "./repository";
import { SynchronizationError } from "./errors";
import { SynchronizationService } from "./service";
import {
  parseDecimalBlock,
  parseDecimalChainId,
  parsePageNumber,
  normalizeSyncAddress,
  normalizeSyncNetworkId,
} from "./validation";

const decimalString = z.string().regex(/^(0|[1-9][0-9]*)$/);
const networkId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const accountAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const scopeQuerySchema = z
  .object({
    networkId,
    chainId: decimalString,
    accountAddress,
  })
  .strict();
const activityQuerySchema = scopeQuerySchema
  .extend({
    startBlock: decimalString,
    endBlock: decimalString,
    limit: decimalString.optional(),
    offset: decimalString.optional(),
  })
  .strict();
const checkpointBodySchema = scopeQuerySchema
  .extend({
    startBlock: decimalString,
    endBlock: decimalString,
  })
  .strict();

function toHttpError(error: unknown): HttpError {
  if (!(error instanceof SynchronizationError)) {
    return new HttpError(
      500,
      "INTERNAL_ERROR",
      "The synchronization request could not be completed.",
    );
  }
  const status =
    error.code === "PERSISTENCE_FAILURE"
      ? 503
      : error.code === "INDEXING_GAP" || error.code === "CONFLICT"
        ? 409
        : 400;
  return new HttpError(status, error.code, error.message);
}

function scopeFromInput(input: {
  networkId: string;
  chainId: string;
  accountAddress: string;
}) {
  return {
    networkId: normalizeSyncNetworkId(input.networkId),
    chainId: parseDecimalChainId(input.chainId),
    accountAddress: normalizeSyncAddress(input.accountAddress),
  };
}

export function createSynchronizationRouter(
  config: ServerConfig,
  service = new SynchronizationService(
    {
      enabled: config.indexer.enabled,
      networks: config.indexer.networks,
      bounds: {
        maxBlockRange: Math.min(
          config.indexer.bounds.maxBlockRange,
          config.indexer.bounds.maxLogRange,
        ),
        maxPageSize: Math.min(100, config.indexer.bounds.maxLogsPerRequest),
        maxOffset: 1_000,
        maxErrorLength: config.indexer.bounds.maxErrorLength,
      },
    },
    createSynchronizationRepository(config),
  ),
  accountAuthorization: AccountAuthorizationBoundary =
    createFailClosedAccountAuthorizationBoundary(),
): IRouter {
  const router: IRouter = Router();

  router.get(
    "/synchronization/status",
    validateQuery(scopeQuerySchema),
    requireAccountAuthorization(accountAuthorization, (request) =>
      scopeFromInput(
        request.validatedQuery as z.infer<typeof scopeQuerySchema>,
      ),
    ),
    async (request, response, next) => {
      try {
        const scope = authorizedAccountScope(request);
        response.json({
          data: await service.getStatus(scope),
        });
      } catch (error) {
        next(error instanceof SynchronizationError ? toHttpError(error) : error);
      }
    },
  );

  router.get(
    "/synchronization/activity",
    validateQuery(activityQuerySchema),
    requireAccountAuthorization(accountAuthorization, (request) =>
      scopeFromInput(
        request.validatedQuery as z.infer<typeof activityQuerySchema>,
      ),
    ),
    async (request, response, next) => {
      try {
        const query = request.validatedQuery as z.infer<
          typeof activityQuerySchema
        >;
        const limit = parsePageNumber(
          query.limit,
          "The page size",
          100,
          50,
        );
        const offset = parsePageNumber(
          query.offset,
          "The page offset",
          1_000,
          0,
        );
        const page = await service.getActivity(
          authorizedAccountScope(request),
          parseDecimalBlock(query.startBlock, "The start block"),
          parseDecimalBlock(query.endBlock, "The end block"),
          limit,
          offset,
        );
        response.json({
          data: {
            ...page,
            items: page.items.map((item) => ({
              ...item,
              localActivityId: null,
            })),
          },
        });
      } catch (error) {
        next(error instanceof SynchronizationError ? toHttpError(error) : error);
      }
    },
  );

  router.get(
    "/synchronization/reconciliation",
    validateQuery(activityQuerySchema),
    requireAccountAuthorization(accountAuthorization, (request) =>
      scopeFromInput(
        request.validatedQuery as z.infer<typeof activityQuerySchema>,
      ),
    ),
    async (request, response, next) => {
      try {
        const query = request.validatedQuery as z.infer<
          typeof activityQuerySchema
        >;
        const limit = parsePageNumber(
          query.limit,
          "The page size",
          100,
          50,
        );
        const offset = parsePageNumber(
          query.offset,
          "The page offset",
          1_000,
          0,
        );
        const page = await service.getActivity(
          authorizedAccountScope(request),
          parseDecimalBlock(query.startBlock, "The start block"),
          parseDecimalBlock(query.endBlock, "The end block"),
          limit,
          offset,
        );
        response.json({
          data: {
            scope: page.scope,
            startBlock: page.startBlock,
            endBlock: page.endBlock,
            items: page.items.map((item) => ({
              identity: item.identity,
              kind: item.kind,
              transactionHash: item.transactionHash,
              logIndex: item.kind === "erc20_transfer" ? item.logIndex : null,
              localActivityId: null,
              state: item.reconciliationState,
              matchEvidence: item.matchEvidence,
            })),
            totalReturned: page.totalReturned,
            offset: page.offset,
            limit: page.limit,
            nextOffset: page.nextOffset,
          },
        });
      } catch (error) {
        next(error instanceof SynchronizationError ? toHttpError(error) : error);
      }
    },
  );

  router.post(
    "/synchronization/checkpoint",
    validateBody(checkpointBodySchema),
    requireAccountAuthorization(accountAuthorization, (request) =>
      scopeFromInput(
        request.validatedBody as z.infer<typeof checkpointBodySchema>,
      ),
    ),
    async (request, response, next) => {
      try {
        const body = request.validatedBody as z.infer<
          typeof checkpointBodySchema
        >;
        response.json({
          data: await service.synchronizeRange(
            authorizedAccountScope(request),
            parseDecimalBlock(body.startBlock, "The start block"),
            parseDecimalBlock(body.endBlock, "The end block"),
          ),
        });
      } catch (error) {
        next(error instanceof SynchronizationError ? toHttpError(error) : error);
      }
    },
  );

  return router;
}