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
    public readonly maxKeys = 10_000,
  ) {}

  check(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const currentTime = this.now();
    this.removeExpired(currentTime);
    const existing = this.buckets.get(key);
    if (!existing && this.buckets.size >= this.maxKeys) {
      return { allowed: false, retryAfterSeconds: 1 };
    }
    const bucket = existing ?? {
      count: 0,
      resetAt: currentTime + this.windowMs,
    };
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

  get keyCount(): number {
    return this.buckets.size;
  }

  private removeExpired(currentTime: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= currentTime) {
        this.buckets.delete(key);
      }
    }
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