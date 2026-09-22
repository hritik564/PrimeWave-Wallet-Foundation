import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./errors";

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

export interface AuthorizedAccountScope {
  readonly networkId: string;
  readonly chainId: number;
  readonly accountAddress: string;
}

export interface AccountAuthorization {
  readonly principal: AuthenticatedPrincipal;
  readonly scope: AuthorizedAccountScope;
}

/**
 * This is the server authorization seam for account-scoped APIs.
 *
 * The production implementation remains deliberately fail-closed until a
 * server-verifiable ownership-proof protocol is approved. A caller-supplied
 * public address, installation identifier, or authentication flag is not an
 * implementation of this boundary.
 */
export interface AccountAuthorizationBoundary {
  authorize(
    request: Request,
    requestedScope: AuthorizedAccountScope,
  ):
    | Promise<AccountAuthorization>
    | AccountAuthorization;
}

export type AuthorizationErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "INVALID_AUTHENTICATION"
  | "AUTHORIZATION_REQUIRED"
  | "UNAUTHORIZED_SCOPE";

export class AuthorizationError extends Error {
  constructor(
    public readonly code: AuthorizationErrorCode,
    public readonly statusCode: 401 | 403 | 503,
    message: string,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function createFailClosedAccountAuthorizationBoundary(
  authentication: AuthenticationBoundary = deferredAuthenticationBoundary,
): AccountAuthorizationBoundary {
  return {
    async authorize(request) {
      const principal = await authentication.authenticate(request);
      if (!principal) {
        throw new AuthorizationError(
          "AUTHENTICATION_REQUIRED",
          401,
          "Authentication is required for this account-scoped request.",
        );
      }

      // A principal without a reviewed, server-verifiable account scope is
      // intentionally insufficient. Do not turn the deferred auth contract
      // into address-based authorization.
      throw new AuthorizationError(
        "AUTHORIZATION_REQUIRED",
        503,
        "Account ownership authorization is not configured.",
      );
    },
  };
}

export function requireAccountAuthorization(
  boundary: AccountAuthorizationBoundary,
  scopeFromRequest: (request: Request) => AuthorizedAccountScope,
) {
  return (
    request: Request,
    _response: Response,
    next: NextFunction,
  ): void => {
    Promise.resolve()
      .then(() => {
        const requestedScope = scopeFromRequest(request);
        return Promise.resolve(
          boundary.authorize(request, requestedScope),
        ).then((authorization) => ({ authorization, requestedScope }));
      })
      .then(({ authorization, requestedScope }) => {
        if (
          authorization.scope.networkId !== requestedScope.networkId ||
          authorization.scope.chainId !== requestedScope.chainId ||
          authorization.scope.accountAddress !== requestedScope.accountAddress
        ) {
          throw new AuthorizationError(
            "UNAUTHORIZED_SCOPE",
            403,
            "The requested account scope is not authorized.",
          );
        }
        request.accountAuthorization = authorization;
        next();
      })
      .catch((error: unknown) => {
        if (error instanceof AuthorizationError) {
          next(
            new HttpError(
              error.statusCode,
              error.code,
              error.message,
            ),
          );
          return;
        }
        next(error);
      });
  };
}

export function authorizedAccountScope(
  request: Request,
): AuthorizedAccountScope {
  const authorization = request.accountAuthorization;
  if (!authorization) {
    throw new HttpError(
      500,
      "AUTHORIZATION_CONTEXT_MISSING",
      "The account authorization context is missing.",
    );
  }
  return authorization.scope;
}

export interface TransactionSigningAuthorizationBoundary {
  authorizeLocalSigning(
    _principal: AuthenticatedPrincipal,
    _requestId: string,
  ): Promise<false> | false;
}