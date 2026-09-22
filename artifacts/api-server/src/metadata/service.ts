import { HttpError } from "../lib/errors";
import { normalizeEvmAddress } from "./validation";
import type {
  MetadataRepository,
  PublicNetworkMetadata,
  PublicTokenMetadata,
  StoredNetworkMetadata,
  StoredTokenMetadata,
} from "./types";

function isoDate(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safePublicUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function safeTemplate(value: string | null): string | null {
  if (!value || !value.includes("{")) return safePublicUrl(value);
  const placeholder = value.match(/\{(?:address|txHash)\}/)?.[0];
  if (!placeholder) return null;
  const withoutTemplate = value.replace(/\{(?:address|txHash)\}/g, "placeholder");
  const safeValue = safePublicUrl(withoutTemplate);
  return safeValue ? safeValue.replace("placeholder", placeholder) : null;
}

function safeReference(value: string | null): string | null {
  if (!value || value.length > 512) return null;
  if (/^https?:\/\//i.test(value)) return safePublicUrl(value);
  return /^[a-z0-9][a-z0-9._:/-]{0,511}$/i.test(value) ? value : null;
}

function networkFromStored(row: StoredNetworkMetadata): PublicNetworkMetadata {
  return {
    networkId: row.networkId,
    chainId: row.chainId,
    displayName: row.displayName,
    nativeCurrency: {
      name: row.nativeCurrencyName,
      symbol: row.nativeCurrencySymbol,
      decimals: row.nativeCurrencyDecimals,
    },
    explorer: {
      name: row.explorerName,
      baseUrl: safePublicUrl(row.explorerBaseUrl),
      addressUrlTemplate: safeTemplate(row.explorerAddressUrlTemplate),
      transactionUrlTemplate: safeTemplate(row.explorerTransactionUrlTemplate),
    },
    environment: row.environment,
    isPrimary: row.isPrimary,
    enabled: row.enabled,
    configurationStatus: row.configurationStatus,
    configurationNote: row.configurationNote,
    rpc: { configured: row.rpcConfigured },
    updatedAt: isoDate(row.updatedAt),
  };
}

function tokenFromStored(row: StoredTokenMetadata): PublicTokenMetadata {
  let logo: PublicTokenMetadata["logo"] = null;
  const logoReference = safeReference(row.logoReference);
  if (logoReference && row.logoProvenance !== "unavailable") {
    logo = {
      reference: logoReference,
      provenance: row.logoProvenance,
    };
  }
  return {
    networkId: row.networkId,
    contractAddress: normalizeEvmAddress(row.contractAddress),
    name: row.name,
    symbol: row.symbol,
    decimals: row.decimals,
    description: row.description,
    logo,
    metadataStatus: row.metadataStatus,
    provenance: {
      source: row.provenance,
      reference: safeReference(row.provenanceReference),
      observedAt: isoDate(row.updatedAt),
    },
    verificationStatus: row.verificationStatus,
    discoveryStatus: row.discoveryStatus,
    visibility: row.visibility,
    trustStatus: row.trustStatus,
    freshnessStatus: row.freshnessStatus,
    updatedAt: isoDate(row.updatedAt),
  };
}

function unavailableToken(
  networkId: string,
  contractAddress: string,
): PublicTokenMetadata {
  return {
    networkId,
    contractAddress,
    name: null,
    symbol: null,
    decimals: null,
    description: null,
    logo: null,
    metadataStatus: "unavailable",
    provenance: {
      source: "unavailable",
      reference: null,
      observedAt: null,
    },
    verificationStatus: "unverified",
    discoveryStatus: "not_discovered",
    visibility: "public",
    trustStatus: "unassessed",
    freshnessStatus: "unavailable",
    updatedAt: null,
  };
}

export class MetadataService {
  private readonly networksById: ReadonlyMap<string, PublicNetworkMetadata>;

  constructor(
    private readonly repository: MetadataRepository,
    networks: readonly PublicNetworkMetadata[],
  ) {
    this.networksById = new Map(
      networks.map((network) => [network.networkId, network]),
    );
  }

  async listNetworks(): Promise<readonly PublicNetworkMetadata[]> {
    let stored: readonly StoredNetworkMetadata[] = [];
    try {
      stored = await this.repository.listNetworks();
    } catch {
      return [...this.networksById.values()];
    }
    if (stored.length > 0) {
      const storedById = new Map(stored.map((network) => [network.networkId, network]));
      return [...this.networksById.keys()]
        .map((networkId) => storedById.get(networkId) ?? this.networksById.get(networkId))
        .filter((network): network is PublicNetworkMetadata | StoredNetworkMetadata => Boolean(network))
        .map((network) =>
          "nativeCurrencyName" in network
            ? networkFromStored(network)
            : network,
        );
    }
    return [...this.networksById.values()];
  }

  async getToken(
    networkId: string,
    contractAddress: string,
  ): Promise<PublicTokenMetadata> {
    this.assertKnownNetwork(networkId);
    const normalizedAddress = normalizeEvmAddress(contractAddress);
    let stored: StoredTokenMetadata | null = null;
    try {
      stored = await this.repository.getToken(networkId, normalizedAddress);
    } catch {
      return unavailableToken(networkId, normalizedAddress);
    }
    return stored
      ? tokenFromStored(stored)
      : unavailableToken(networkId, normalizedAddress);
  }

  async listTokens(
    networkId: string,
    contractAddresses: readonly string[],
  ): Promise<readonly PublicTokenMetadata[]> {
    this.assertKnownNetwork(networkId);
    const normalizedAddresses = contractAddresses.map(normalizeEvmAddress);
    let stored: readonly StoredTokenMetadata[] = [];
    try {
      stored = await this.repository.listTokens(networkId, normalizedAddresses);
    } catch {
      return normalizedAddresses.map((address) =>
        unavailableToken(networkId, address),
      );
    }
    const storedByAddress = new Map(
      stored.map((token) => [normalizeEvmAddress(token.contractAddress), token]),
    );
    return normalizedAddresses.map((address) => {
      const record = storedByAddress.get(address);
      return record
        ? tokenFromStored(record)
        : unavailableToken(networkId, address);
    });
  }

  private assertKnownNetwork(networkId: string): void {
    if (!this.networksById.has(networkId)) {
      throw new HttpError(400, "INVALID_NETWORK", "The network ID is not supported.");
    }
  }
}