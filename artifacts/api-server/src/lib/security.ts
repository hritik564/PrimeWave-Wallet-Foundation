import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./errors";

const SECRET_FIELD_NAMES = new Set([
  "privatekey",
  "mnemonic",
  "seed",
  "seedphrase",
  "recoveryphrase",
  "secretkey",
  "signingkey",
  "walletpin",
  "pin",
  "vaultkey",
  "encryptionkey",
  "securestore",
  "securevault",
  "signingcapability",
  "vaulthandle",
]);

function normalizedFieldName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function isProhibitedFieldName(value: string): boolean {
  return SECRET_FIELD_NAMES.has(normalizedFieldName(value));
}

export function assertNoSecretMaterial(
  value: unknown,
  seen = new Set<object>(),
): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const child of value) assertNoSecretMaterial(child, seen);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (isProhibitedFieldName(key)) {
      throw new HttpError(
        400,
        "PROHIBITED_SECRET_MATERIAL",
        "The request contains prohibited wallet secret material.",
      );
    }
    assertNoSecretMaterial(child, seen);
  }
}

export function secretMaterialGuard(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  assertNoSecretMaterial(request.body);
  assertNoSecretMaterial(request.query);
  assertNoSecretMaterial(request.params);
  next();
}

export function securityHeaders(
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'none'");
  response.setHeader("Cache-Control", "no-store");
  next();
}