export type ActivityErrorCode =
  | 'INVALID_RECORD'
  | 'INVALID_QUERY'
  | 'DUPLICATE_RECORD'
  | 'RECORD_NOT_FOUND'
  | 'SCOPE_MISMATCH'
  | 'IDENTITY_CONFLICT'
  | 'INVALID_STATUS_TRANSITION'
  | 'LIFECYCLE_MISMATCH'
  | 'PERSISTENCE_CORRUPT'
  | 'PERSISTENCE_CLEARED';

const MESSAGES: Record<ActivityErrorCode, string> = {
  INVALID_RECORD: 'The activity record is invalid.',
  INVALID_QUERY: 'The activity query is invalid.',
  DUPLICATE_RECORD: 'This transaction activity record already exists.',
  RECORD_NOT_FOUND: 'The transaction activity record was not found.',
  SCOPE_MISMATCH: 'The activity record does not belong to this account or network.',
  IDENTITY_CONFLICT: 'The activity record identity conflicts with an existing record.',
  INVALID_STATUS_TRANSITION: 'The transaction activity state transition is not allowed.',
  LIFECYCLE_MISMATCH: 'The lifecycle result does not match the activity record.',
  PERSISTENCE_CORRUPT: 'Local Activity storage needs recovery and is unavailable.',
  PERSISTENCE_CLEARED: 'This wallet Activity store has been cleared.',
};

export class ActivityError extends Error {
  constructor(public readonly code: ActivityErrorCode) {
    super(MESSAGES[code]);
    this.name = 'ActivityError';
  }
}
