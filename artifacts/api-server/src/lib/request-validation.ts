import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { HttpError } from "./errors";

export function validateBody<T>(schema: ZodType<T>) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      next(new HttpError(400, "INVALID_REQUEST", "The request body is invalid."));
      return;
    }
    request.body = parsed.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodType<T>) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(request.query);
    if (!parsed.success) {
      next(new HttpError(400, "INVALID_QUERY", "The query parameters are invalid."));
      return;
    }
    request.query = parsed.data as Request["query"];
    next();
  };
}

export function validateParams<T>(schema: ZodType<T>) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(request.params);
    if (!parsed.success) {
      next(new HttpError(400, "INVALID_PATH", "The path parameters are invalid."));
      return;
    }
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