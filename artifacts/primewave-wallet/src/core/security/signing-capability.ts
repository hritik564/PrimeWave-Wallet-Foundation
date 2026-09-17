import type { SigningCapability } from './contracts';

type CapabilityContext = {
  readonly accountId: string;
  readonly transactionDigest: string;
  consumed: boolean;
};

const capabilityContexts = new WeakMap<object, CapabilityContext>();

export function issueSigningCapability(context: {
  readonly accountId: string;
  readonly transactionDigest: string;
}): SigningCapability {
  const token = Object.freeze({ kind: 'signing-capability' });
  capabilityContexts.set(token, {
    accountId: context.accountId,
    transactionDigest: context.transactionDigest,
    consumed: false,
  });
  return token as SigningCapability;
}

export function consumeSigningCapability(
  capability: SigningCapability,
  context: {
    readonly accountId: string;
    readonly transactionDigest: string;
  },
): boolean {
  if (typeof capability !== 'object' || capability === null) {
    return false;
  }

  const record = capabilityContexts.get(capability);
  if (
    !record ||
    record.consumed ||
    record.accountId !== context.accountId ||
    record.transactionDigest !== context.transactionDigest
  ) {
    return false;
  }

  record.consumed = true;
  capabilityContexts.delete(capability);
  return true;
}