import type { Request } from "express";

export interface AuthenticatedPrincipal {
  readonly subject: string;
  readonly authenticationMethod: "future";
}

export interface AuthenticationBoundary {
  authenticate(
    request: Request,
  ): Promise<AuthenticatedPrincipal | null> | AuthenticatedPrincipal | null;
}

export const deferredAuthenticationBoundary: AuthenticationBoundary = {
  authenticate: () => null,
};

export interface WalletOwnershipBoundary {
  verifyPublicAddressOwnership(
    _principal: AuthenticatedPrincipal,
    _address: string,
  ): Promise<boolean> | boolean;
}

export interface TransactionSigningAuthorizationBoundary {
  authorizeLocalSigning(
    _principal: AuthenticatedPrincipal,
    _requestId: string,
  ): Promise<false> | false;
}