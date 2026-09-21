import type { MessageSigningCapability } from './contracts';

type CapabilityContext = {
  readonly accountId: string;
  readonly requestDigest: string;
  consumed: boolean;
};

const capabilityContexts = new WeakMap<object, CapabilityContext>();

export function issueMessageSigningCapability(context: {
  readonly accountId: string;
  readonly requestDigest: string;
}): MessageSigningCapability {
  const token = Object.freeze({ kind: 'message-signing-capability' });
  capabilityContexts.set(token, {
    accountId: context.accountId,
    requestDigest: context.requestDigest,
    consumed: false,
  });
  return token as MessageSigningCapability;
}

export function consumeMessageSigningCapability(
  capability: MessageSigningCapability,
  context: {
    readonly accountId: string;
    readonly requestDigest: string;
  },
): boolean {
  if (typeof capability !== 'object' || capability === null) return false;
  const record = capabilityContexts.get(capability);
  if (
    !record ||
    record.consumed ||
    record.accountId !== context.accountId ||
    record.requestDigest !== context.requestDigest
  ) {
    return false;
  }
  record.consumed = true;
  capabilityContexts.delete(capability);
  return true;
}