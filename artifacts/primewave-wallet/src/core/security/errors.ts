export interface SafeError {
  code: 'UNEXPECTED_ERROR' | 'UNSAFE_ERROR';
  message: string;
  details?: string;
}

const unsafeErrorPattern =
  /(seed phrase|mnemonic|private key|signing key|wallet password|wallet pin|biometric|encryption key|decrypted vault|authentication secret)/i;

export function sanitizeError(error: unknown): SafeError {
  const message = error instanceof Error ? error.message : '';

  if (!message || unsafeErrorPattern.test(message)) {
    return {
      code: 'UNSAFE_ERROR',
      message: 'An unexpected error occurred.',
    };
  }

  return {
    code: 'UNEXPECTED_ERROR',
    message: 'The app could not complete that operation.',
  };
}

export function formatSafeErrorDetails(error: unknown): string {
  const safeError = sanitizeError(error);
  return `Code: ${safeError.code}\n\n${safeError.message}`;
}