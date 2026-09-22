import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { HttpError } from "./errors";
import { randomUUID } from "node:crypto";

declare global {
  namespace Express {
    interface Request {
      validatedBody?: unknown;
      validatedQuery?: unknown;
      validatedParams?: unknown;
    }
  }
}

export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const supplied = request.header("x-request-id")?.trim();
  const requestId =
    supplied && supplied.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(supplied)
      ? supplied
      : randomUUID();
  request.id = requestId;
  response.setHeader("X-Request-ID", requestId);
  next();
}

export function validateBody<T>(schema: ZodType<T, any, any>) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      next(new HttpError(400, "INVALID_REQUEST", "The request body is invalid."));
      return;
    }
    request.validatedBody = parsed.data;
    request.body = parsed.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodType<T, any, any>) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(request.query);
    if (!parsed.success) {
      next(new HttpError(400, "INVALID_QUERY", "The query parameters are invalid."));
      return;
    }
    request.validatedQuery = parsed.data;
    next();
  };
}

export function validateParams<T>(schema: ZodType<T, any, any>) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(request.params);
    if (!parsed.success) {
      next(new HttpError(400, "INVALID_PATH", "The path parameters are invalid."));
      return;
    }
    request.validatedParams = parsed.data;
    request.params = parsed.data as Request["params"];
    next();
  };
}

export function requireJsonContentType(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  if (!["POST", "PUT", "PATCH"].includes(request.method)) {
    next();
    return;
  }
  const contentLength = Number(request.headers["content-length"] ?? "0");
  if (contentLength === 0 && !request.headers["transfer-encoding"]) {
    next();
    return;
  }
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    next(
      new HttpError(
        415,
        "UNSUPPORTED_CONTENT_TYPE",
        "Requests with a body must use application/json.",
      ),
    );
    return;
  }
  next();
}