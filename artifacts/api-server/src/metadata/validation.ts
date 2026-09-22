import { z } from "zod";

export const MAX_TOKEN_BATCH_SIZE = 50;

const NETWORK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export const networkIdSchema = z
  .string()
  .trim()
  .regex(NETWORK_ID_PATTERN, "Invalid network ID.");

export const evmAddressSchema = z
  .string()
  .trim()
  .regex(EVM_ADDRESS_PATTERN, "Invalid EVM contract address.")
  .transform((value) => value.toLowerCase());

export const tokenParamsSchema = z.object({
  networkId: networkIdSchema,
  contractAddress: evmAddressSchema,
});

const batchAddressesSchema = z.preprocess(
  (value) => {
    if (typeof value === "string") return value.split(",");
    return value;
  },
  z.array(evmAddressSchema).min(1).max(MAX_TOKEN_BATCH_SIZE),
);

export const tokenBatchQuerySchema = z
  .object({
    networkId: networkIdSchema,
    addresses: batchAddressesSchema,
  })
  .strict();

export function normalizeEvmAddress(value: string): string {
  const result = evmAddressSchema.safeParse(value);
  if (!result.success) throw new Error("Invalid EVM contract address.");
  return result.data;
}