import type { ErrorRequestHandler, Request } from "express";
import { ZodError } from "zod";
import { logger, sanitizeForLog } from "./logger";

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function requestIdFrom(request: Request): string {
  return typeof request.id === "string" ? request.id : "unknown";
}

export function publicErrorResponse(
  request: Request,
  code: string,
  message: string,
) {
  return {
    error: {
      code,
      message,
      requestId: requestIdFrom(request),
    },
  };
}

export const errorHandler: ErrorRequestHandler = (
  error,
  request,
  response,
  _next,
) => {
  if (error instanceof HttpError) {
    response
      .status(error.statusCode)
      .json(publicErrorResponse(request, error.code, error.message));
    return;
  }
  if (error instanceof ZodError) {
    response
      .status(400)
      .json(
        publicErrorResponse(
          request,
          "INVALID_REQUEST",
          "The request is invalid.",
        ),
      );
    return;
  }
  if ((error as { type?: string } | undefined)?.type === "entity.too.large") {
    response
      .status(413)
      .json(
        publicErrorResponse(
          request,
          "REQUEST_TOO_LARGE",
          "The request body is too large.",
        ),
      );
    return;
  }
  if ((error as { type?: string } | undefined)?.type === "entity.parse.failed") {
    response
      .status(400)
      .json(
        publicErrorResponse(
          request,
          "INVALID_JSON",
          "The request body is not valid JSON.",
        ),
      );
    return;
  }

  logger.error(
    {
      requestId: requestIdFrom(request),
      error: sanitizeForLog(error),
    },
    "Unhandled API error",
  );
  response
    .status(500)
    .json(
      publicErrorResponse(
        request,
        "INTERNAL_ERROR",
        "The server could not complete the request.",
      ),
    );
};