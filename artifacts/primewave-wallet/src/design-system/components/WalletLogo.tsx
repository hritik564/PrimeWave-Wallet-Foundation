import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { View } from 'react-native';
import type { AssetIdentity } from '@/src/core/assets';
import { networkArtwork, tokenArtwork } from '../icons/artwork';
import { walletHomeColors as colors } from '../tokens/wallet-home';

const images: Record<string, number> = {
  'networks-arbitrum-one': require('../../../assets/logos/networks-arbitrum-one.png'),
  'networks-base': require('../../../assets/logos/networks-base.png'),
  'networks-binance-smart-chain': require('../../../assets/logos/networks-binance-smart-chain.png'),
  'networks-ethereum': require('../../../assets/logos/networks-ethereum.png'),
  'networks-optimism': require('../../../assets/logos/networks-optimism.png'),
  'networks-polygon': require('../../../assets/logos/networks-polygon.png'),
  'tokens-BNB': require('../../../assets/logos/tokens-BNB.png'),
  'tokens-ETH': require('../../../assets/logos/tokens-ETH.png'),
  'tokens-POL': require('../../../assets/logos/tokens-POL.png'),
  'tokens-USDC': require('../../../assets/logos/tokens-USDC.png'),
};

type Props = ({ networkId: string; asset?: never } | { asset: AssetIdentity | null; networkId?: never }) & { size?: number };

export function WalletLogo(props: Props) {
  const size = props.size ?? 32;
  const key = props.networkId !== undefined ? networkArtwork(props.networkId) : tokenArtwork(props.asset);
  const source = key && images[key];
  return source ? <Image accessible={false} source={source} contentFit="contain" style={{ width: size, height: size, borderRadius: size / 2 }} /> :
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', borderRadius: size / 2, backgroundColor: colors.surface }}>
      <Ionicons name={props.networkId !== undefined ? 'globe-outline' : 'layers-outline'} size={Math.round(size * 0.63)} color={colors.secondaryText} />
    </View>;
}
