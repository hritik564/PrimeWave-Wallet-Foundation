import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./errors";

interface Bucket {
  count: number;
  resetAt: number;
}

export class MemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    public readonly windowMs: number,
    public readonly maxRequests: number,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const currentTime = this.now();
    const existing = this.buckets.get(key);
    const bucket =
      !existing || existing.resetAt <= currentTime
        ? { count: 0, resetAt: currentTime + this.windowMs }
        : existing;
    bucket.count += 1;
    this.buckets.set(key, bucket);
    if (bucket.count <= this.maxRequests) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - currentTime) / 1_000)),
    };
  }

  clear(): void {
    this.buckets.clear();
  }
}

function rateLimitKey(request: Request): string {
  return request.socket.remoteAddress ?? "unknown";
}

export function rateLimitMiddleware(limiter: MemoryRateLimiter) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const result = limiter.check(rateLimitKey(request));
    response.setHeader("X-RateLimit-Limit", String(limiter["maxRequests"]));
    if (!result.allowed) {
      response.setHeader("Retry-After", String(result.retryAfterSeconds));
      next(
        new HttpError(
          429,
          "RATE_LIMITED",
          "Too many requests. Please try again later.",
        ),
      );
      return;
    }
    next();
  };
}