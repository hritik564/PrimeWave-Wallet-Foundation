export { DAppError } from './errors';
export type { DAppErrorCode } from './errors';
export {
  DAPP_CAPABILITIES,
  type DAppCapability,
  type DAppIdentity,
  type DAppPermission,
  type DAppRequestContext,
  type DAppRequestStatus,
  type DAppRequestType,
  type DAppSession,
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
export type {
  DAppTransport,
  DAppTransportEvent,
  DAppTransportRequestEvent,
  DAppTransportRequestHandler,
  DAppTransportResponse,
  DAppTransportSessionEvent,
} from './transport';