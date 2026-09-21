import { DAppError } from './errors';
import type {
  DAppCapability,
  DAppPermission,
  DAppSession,
} from './models';

export function permissionKey(permission: Pick<
  DAppPermission,
  'capability' | 'accountId' | 'networkId'
>): string {
  return `${permission.capability}|${permission.accountId}|${permission.networkId ?? '*'}`;
}

export function hasDAppPermission(
  session: DAppSession,
  capability: DAppCapability,
  accountId: string,
  networkId: string,
  now = Date.now(),
): boolean {
  return (
    session.status === 'active' &&
    (session.expiresAt === null || session.expiresAt > now) &&
    session.approvedCapabilities.includes(capability) &&
    session.permissions.some(
      (permission) =>
        permission.capability === capability &&
        permission.accountId === accountId &&
        (permission.networkId === null || permission.networkId === networkId) &&
        permission.revokedAt === null &&
        permission.grantedAt <= now,
    )
  );
}

export function assertDAppPermission(
  session: DAppSession,
  capability: DAppCapability,
  accountId: string,
  networkId: string,
  now = Date.now(),
): void {
  if (!hasDAppPermission(session, capability, accountId, networkId, now)) {
    throw new DAppError(
      'PERMISSION_DENIED',
      `DApp permission is not granted for ${capability}.`,
    );
  }
}