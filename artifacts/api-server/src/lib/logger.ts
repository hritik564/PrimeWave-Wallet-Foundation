import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

const REDACTED = "[REDACTED]";
const MAX_LOG_STRING_LENGTH = 512;
const sensitiveKeyPattern =
  /(authorization|cookie|private.?key|mnemonic|seed|recovery.?phrase|secret.?key|signing.?key|wallet.?pin|pin|vault|encryption.?key|secure.?store|secure.?vault|token|password|database|connection|string|credential|api.?key|client.?secret)/i;

function sanitizeString(value: string): string {
  const withoutBearer = value.replace(
    /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
    "Bearer [REDACTED]",
  );
  const withoutDatabaseCredentials = withoutBearer.replace(
    /\b(postgres(?:ql)?:\/\/)[^@\s]+@/gi,
    "$1[REDACTED]@",
  );
  return withoutDatabaseCredentials.length > MAX_LOG_STRING_LENGTH
    ? `${withoutDatabaseCredentials.slice(0, MAX_LOG_STRING_LENGTH)}…`
    : withoutDatabaseCredentials;
}

export function sanitizeForLog(
  value: unknown,
  depth = 0,
): unknown {
  if (depth > 4) return "[TRUNCATED]";
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return sanitizeString(value);
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeForLog(value.message, depth + 1),
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeForLog(item, depth + 1));
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = sensitiveKeyPattern.test(key)
        ? REDACTED
        : sanitizeForLog(child, depth + 1);
    }
    return result;
  }
  return REDACTED;
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
    "*.authorization",
    "*.cookie",
    "*.token",
    "*.password",
    "*.databaseUrl",
    "*.connectionString",
    "*.credential",
    "*.apiKey",
    "*.clientSecret",
    "*.privateKey",
    "*.private_key",
    "*.mnemonic",
    "*.seed",
    "*.pin",
    "*.vaultKey",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
