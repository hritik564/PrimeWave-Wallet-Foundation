export { DAppError } from './errors';
export type { DAppErrorCode } from './errors';
export {
  DAPP_CAPABILITIES,
  type DAppCapability,
  type DAppIdentity,
  type DAppPermission,
  type DAppAuthorizationBoundary,
  type DAppAuthorizationDecision,
  type DAppRequestContext,
  type DAppRequestStatus,
  type DAppRequestType,
  type DAppSession,
  type DAppSessionProposal,
  type DAppSessionStatus,
} from './models';
export type {
  DAppAccountAccessPayload,
  DAppChainRequestPayload,
  DAppConnectPayload,
  DAppDisconnectPayload,
  DAppMessageSigningPayload,
  DAppNetworkInformationPayload,
  DAppRequest,
  DAppRequestInput,
  DAppRequestPayload,
  DAppTransactionIntent,
  DAppTransactionRequest,
  DAppMessageSigningRequest,
  DAppTypedDataSigningPayload,
  DAppTypedDataSigningRequest,
} from './request-models';
export {
  assertDAppPermission,
  hasDAppPermission,
  permissionKey,
} from './permissions';
export type {
  DAppSessionRepository,
  DAppSessionScope,
  DAppSessionUpdate,
} from './session-models';
export { InMemoryDAppSessionRepository } from './session-models';
export {
  DAPP_MAX_DESCRIPTION_LENGTH,
  DAPP_MAX_ID_LENGTH,
  DAPP_MAX_MESSAGE_LENGTH,
  DAPP_MAX_METADATA_VERSION_LENGTH,
  DAPP_MAX_NAME_LENGTH,
  DAPP_MAX_REQUEST_ID_LENGTH,
  DAPP_MAX_SESSION_ID_LENGTH,
  DAPP_MAX_TYPED_DATA_LENGTH,
  DAPP_MAX_URL_LENGTH,
  assertDAppRequestSessionContext,
  validateDAppIdentity,
  validateDAppRequest,
  validateDAppRequestInput,
  validateDAppSession,
} from './validation';
export {
  DAppRequestService,
} from './service';
export {
  assertDAppApprovalCheckpoint,
  dappCapabilityLabel,
  toDAppApprovalViewModel,
  type DAppApprovalContext,
  type DAppApprovalNetwork,
  type DAppApprovalStatus,
  type DAppApprovalViewModel,
} from './proposal-models';
export type {
  DAppTransport,
  DAppTransportEvent,
  DAppTransportRequestEvent,
  DAppTransportRequestHandler,
  DAppTransportResponse,
  DAppTransportProposalEvent,
  DAppTransportErrorEvent,
  DAppTransportSessionEvent,
} from './transport';
export {
  normalizeSigningRequest,
  parsePersonalSigningRequest,
  parseTypedDataSigningRequest,
} from './signing/validation';
export {
  normalizeTransactionRequest,
  type TransactionRequestNormalizationInput,
} from './transaction-validation';
export {
  assertDAppTransactionBinding,
  createDAppTransactionBinding,
  type DAppTransactionBinding,
} from './transaction-binding';
export type {
  BoundedDisplay,
  ParsedPersonalMessage,
  ParsedTypedData,
  SigningSessionRequestInput,
} from './signing/validation';
export type {
  DAppMessageSigningAuthorization,
  DAppTypedDataDocument,
  DAppTypedDataField,
  MessageSigningEngineOptions,
  MessageSigningKeyAccess,
} from './signing/models';
export { MessageSigningEngine } from './signing/service';