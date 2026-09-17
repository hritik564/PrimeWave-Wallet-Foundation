import { AssetError } from '@/src/core/assets';

export class PortfolioError extends AssetError {
  constructor(code: Extract<
    AssetError['code'],
    `PORTFOLIO_${string}`
  >) {
    super(code);
    this.name = 'PortfolioError';
  }
}