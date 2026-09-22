import { and, eq, inArray } from "drizzle-orm";
import type { ServerConfig } from "../config";
import { publicNetworkMetadataTable, publicTokenMetadataTable } from "@workspace/db/schema";
import type {
  MetadataRepository,
  StoredNetworkMetadata,
  StoredTokenMetadata,
} from "./types";

function networkRow(
  row: typeof publicNetworkMetadataTable.$inferSelect,
): StoredNetworkMetadata {
  return {
    ...row,
    rpcConfigured: row.configurationStatus === "configured",
  };
}

function tokenRow(
  row: typeof publicTokenMetadataTable.$inferSelect,
): StoredTokenMetadata {
  return row;
}

export class EmptyMetadataRepository implements MetadataRepository {
  async listNetworks(): Promise<readonly StoredNetworkMetadata[]> {
    return [];
  }

  async getToken(): Promise<StoredTokenMetadata | null> {
    return null;
  }

  async listTokens(): Promise<readonly StoredTokenMetadata[]> {
    return [];
  }
}

export class PostgresMetadataRepository implements MetadataRepository {
  constructor(private readonly maxNetworkRows = 100) {}

  private async database() {
    return import("@workspace/db").then(({ db }) => db);
  }

  async listNetworks(): Promise<readonly StoredNetworkMetadata[]> {
    const db = await this.database();
    const rows = await db
      .select()
      .from(publicNetworkMetadataTable)
      .limit(this.maxNetworkRows + 1);
    if (rows.length > this.maxNetworkRows) {
      throw new Error("NETWORK_METADATA_LIMIT");
    }
    return rows.map(networkRow);
  }

  async getToken(
    networkId: string,
    contractAddress: string,
  ): Promise<StoredTokenMetadata | null> {
    const db = await this.database();
    const rows = await db
      .select()
      .from(publicTokenMetadataTable)
      .where(
        and(
          eq(publicTokenMetadataTable.networkId, networkId),
          eq(publicTokenMetadataTable.contractAddress, contractAddress),
        ),
      )
      .limit(1);
    return rows[0] ? tokenRow(rows[0]) : null;
  }

  async listTokens(
    networkId: string,
    contractAddresses: readonly string[],
  ): Promise<readonly StoredTokenMetadata[]> {
    const db = await this.database();
    const rows = await db
      .select()
      .from(publicTokenMetadataTable)
      .where(
        and(
          eq(publicTokenMetadataTable.networkId, networkId),
          inArray(publicTokenMetadataTable.contractAddress, [
            ...contractAddresses,
          ]),
        ),
      );
    return rows.map(tokenRow);
  }
}

export class InMemoryMetadataRepository implements MetadataRepository {
  private readonly networks = new Map<string, StoredNetworkMetadata>();
  private readonly tokens = new Map<string, StoredTokenMetadata>();

  constructor(private readonly maxNetworkRows = 100) {}

  addNetwork(network: StoredNetworkMetadata): void {
    this.networks.set(network.networkId, network);
  }

  addToken(token: StoredTokenMetadata): void {
    const key = `${token.networkId}:${token.contractAddress.toLowerCase()}`;
    if (this.tokens.has(key)) {
      throw new Error("DUPLICATE_METADATA_IDENTITY");
    }
    this.tokens.set(key, token);
  }

  async listNetworks(): Promise<readonly StoredNetworkMetadata[]> {
    const rows = [...this.networks.values()];
    if (rows.length > this.maxNetworkRows) {
      throw new Error("NETWORK_METADATA_LIMIT");
    }
    return rows;
  }

  async getToken(
    networkId: string,
    contractAddress: string,
  ): Promise<StoredTokenMetadata | null> {
    return (
      this.tokens.get(`${networkId}:${contractAddress.toLowerCase()}`) ?? null
    );
  }

  async listTokens(
    networkId: string,
    contractAddresses: readonly string[],
  ): Promise<readonly StoredTokenMetadata[]> {
    const records = await Promise.all(
      contractAddresses.map((address) => this.getToken(networkId, address)),
    );
    return records.filter((record): record is StoredTokenMetadata => record !== null);
  }
}

export function createMetadataRepository(
  config: ServerConfig,
): MetadataRepository {
  return config.databaseUrl
    ? new PostgresMetadataRepository(config.maxNetworkMetadataRows ?? 100)
    : new EmptyMetadataRepository();
}