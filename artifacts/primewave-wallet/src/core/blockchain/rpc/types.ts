import type { RpcEndpoint } from '@/src/core/networks/types';

export type JsonRpcId = number | string;
export type RpcBlockTag = 'latest' | 'earliest' | 'pending' | `0x${string}`;
export type HexQuantity = `0x${string}`;

export interface RpcCallObject {
  readonly from?: string;
  readonly to?: string;
  readonly gas?: HexQuantity;
  readonly gasPrice?: HexQuantity;
  readonly maxFeePerGas?: HexQuantity;
  readonly maxPriorityFeePerGas?: HexQuantity;
  readonly value?: HexQuantity;
  readonly data?: `0x${string}`;
}

export interface EvmRpcMethodMap {
  eth_chainId: {
    readonly params: readonly [];
    readonly result: HexQuantity;
  };
  eth_blockNumber: {
    readonly params: readonly [];
    readonly result: HexQuantity;
  };
  eth_getBalance: {
    readonly params: readonly [address: string, blockTag?: RpcBlockTag];
    readonly result: HexQuantity;
  };
  eth_getTransactionCount: {
    readonly params: readonly [address: string, blockTag?: RpcBlockTag];
    readonly result: HexQuantity;
  };
  eth_getCode: {
    readonly params: readonly [address: string, blockTag?: RpcBlockTag];
    readonly result: `0x${string}`;
  };
  eth_call: {
    readonly params: readonly [call: RpcCallObject, blockTag?: RpcBlockTag];
    readonly result: `0x${string}`;
  };
  eth_getTransactionByHash: {
    readonly params: readonly [transactionHash: string];
    readonly result: Record<string, unknown> | null;
  };
  eth_getTransactionReceipt: {
    readonly params: readonly [transactionHash: string];
    readonly result: Record<string, unknown> | null;
  };
  eth_estimateGas: {
    readonly params: readonly [call: RpcCallObject, blockTag?: RpcBlockTag];
    readonly result: HexQuantity;
  };
  eth_gasPrice: {
    readonly params: readonly [];
    readonly result: HexQuantity;
  };
  eth_maxPriorityFeePerGas: {
    readonly params: readonly [];
    readonly result: HexQuantity;
  };
  eth_getBlockByNumber: {
    readonly params: readonly [
      blockTag: RpcBlockTag,
      includeTransactions: boolean,
    ];
    readonly result: Record<string, unknown> | null;
  };
  eth_getBlockByHash: {
    readonly params: readonly [
      blockHash: string,
      includeTransactions: boolean,
    ];
    readonly result: Record<string, unknown> | null;
  };
  eth_sendRawTransaction: {
    readonly params: readonly [signedTransaction: string];
    readonly result: string;
  };
}

export type EvmRpcMethod = keyof EvmRpcMethodMap;
export type EvmRpcParams<M extends EvmRpcMethod> = EvmRpcMethodMap[M]['params'];
export type EvmRpcResult<M extends EvmRpcMethod> = EvmRpcMethodMap[M]['result'];

export interface JsonRpcRequest<M extends EvmRpcMethod = EvmRpcMethod> {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly method: M;
  readonly params: EvmRpcParams<M>;
}

export interface JsonRpcErrorObject {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface JsonRpcSuccessResponse<T = unknown> {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly result: T;
  readonly error?: never;
}

export interface JsonRpcErrorResponse {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly error: JsonRpcErrorObject;
  readonly result?: never;
}

export type JsonRpcResponse<T = unknown> =
  | JsonRpcSuccessResponse<T>
  | JsonRpcErrorResponse;

export interface RpcTransportRequest {
  readonly endpoint: RpcEndpoint;
  readonly body: string;
  readonly timeoutMs: number;
}

export interface RpcTransportResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface RpcTransport {
  request(request: RpcTransportRequest): Promise<RpcTransportResponse>;
}

export interface RpcProviderOptions {
  readonly timeoutMs?: number;
  readonly transport?: RpcTransport;
}