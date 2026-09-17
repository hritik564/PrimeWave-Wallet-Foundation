export interface WalletAccount {
  accountId: string;
  index: number;
  address: string;
  derivationPath: string;
}

export interface Wallet {
  walletId: string;
  createdAt: string;
  accountCount: number;
  accounts: WalletAccount[];
}