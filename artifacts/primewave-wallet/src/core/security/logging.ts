export type SecureLogLevel = 'debug' | 'info' | 'warning' | 'error';

export type SecureLogValue = string | number | boolean | null;

export type SecureLogContext = Record<
  string,
  SecureLogValue | undefined
>;

const forbiddenKeyPattern =
  /(seed|mnemonic|private.?key|signing.?key|password|pin|biometric|secret|vault|encryption.?key|auth)/i;

const sensitiveTextPattern =
  /(seed phrase|mnemonic|private key|signing key|wallet password|wallet pin|biometric|encryption key|decrypted vault|authentication secret)/i;

function sanitizeMessage(message: string): string {
  return sensitiveTextPattern.test(message)
    ? '[REDACTED SECURITY MESSAGE]'
    : message;
}

function sanitizeValue(key: string, value: SecureLogValue): SecureLogValue {
  if (forbiddenKeyPattern.test(key)) {
    return '[REDACTED]';
  }

  if (typeof value === 'string' && sensitiveTextPattern.test(value)) {
    return '[REDACTED]';
  }

  return value;
}

export function sanitizeLogContext(
  context?: Record<string, unknown>,
): SecureLogContext | undefined {
  if (!context) {
    return undefined;
  }

  const safeContext: SecureLogContext = {};

  for (const [key, value] of Object.entries(context)) {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      safeContext[key] = sanitizeValue(key, value);
    } else {
      safeContext[key] = '[REDACTED]';
    }
  }

  return safeContext;
}

export interface SecureLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warning(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

function writeLog(
  level: SecureLogLevel,
  message: string,
  context?: Record<string, unknown>,
): void {
  const safeContext = sanitizeLogContext(context);
  const safeMessage = sanitizeMessage(message);
  const output = safeContext ? [safeMessage, safeContext] : [safeMessage];

  if (level === 'error') {
    console.error(...output);
  } else if (level === 'warning') {
    console.warn(...output);
  } else if (level === 'debug') {
    console.debug(...output);
  } else {
    console.info(...output);
  }
}

export const secureLogger: SecureLogger = {
  debug: (message, context) => writeLog('debug', message, context),
  info: (message, context) => writeLog('info', message, context),
  warning: (message, context) => writeLog('warning', message, context),
  error: (message, context) => writeLog('error', message, context),
};