export type AccountStateErrorCode =
  | 'INVALID_ADDRESS'
  | 'NETWORK_CHANGED'
  | 'CONFIGURATION_ERROR';

const SAFE_MESSAGES: Record<AccountStateErrorCode, string> = {
  INVALID_ADDRESS: 'The public EVM address is invalid.',
  NETWORK_CHANGED: 'The selected network changed during the read.',
  CONFIGURATION_ERROR: 'The account-state service is not configured.',
};

export class AccountStateError extends Error {
  constructor(public readonly code: AccountStateErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'AccountStateError';
  }
}