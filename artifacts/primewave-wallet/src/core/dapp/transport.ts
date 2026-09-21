import type { DAppRequest } from './request-models';
import type { DAppSession, DAppSessionProposal } from './models';

export interface DAppTransportRequestEvent {
  readonly type: 'request';
  readonly request: unknown;
}

export interface DAppTransportSessionEvent {
  readonly type: 'session';
  readonly event:
    | 'approved'
    | 'updated'
    | 'disconnected'
    | 'expired'
    | 'revoked';
  readonly session: DAppSession;
}

export interface DAppTransportProposalEvent {
  readonly type: 'proposal';
  readonly proposal: DAppSessionProposal;
}

export interface DAppTransportErrorEvent {
  readonly type: 'error';
  readonly errorCode: string;
}

export type DAppTransportEvent =
  | DAppTransportRequestEvent
  | DAppTransportSessionEvent
  | DAppTransportProposalEvent
  | DAppTransportErrorEvent;

export interface DAppTransportResponse {
  readonly requestId: string;
  readonly status: 'approved' | 'rejected' | 'completed' | 'failed';
  readonly result?: unknown;
  readonly errorCode?: string;
}

export interface DAppTransport {
  readonly providerId: string;
  start(listener: (event: DAppTransportEvent) => void): Promise<void> | void;
  stop(): Promise<void> | void;
  sendResponse(response: DAppTransportResponse): Promise<void> | void;
  disconnect(sessionId: string): Promise<void> | void;
}

export type DAppTransportRequestHandler = (
  request: DAppRequest,
) => Promise<DAppTransportResponse> | DAppTransportResponse;