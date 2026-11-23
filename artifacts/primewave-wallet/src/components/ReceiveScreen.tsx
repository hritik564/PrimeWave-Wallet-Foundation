import { WalletLogo } from '@/src/design-system/components/WalletLogo';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { WaveXBottomSheet } from '@/src/design-system';
import { walletHomeColors as colors } from '@/src/design-system/tokens/wallet-home';
import type { EvmNetwork, NetworkRegistry } from '@/src/core/networks';
import type { Wallet } from '@/src/core/wallet/models';
import { copyPublicAddress, createPublicAddressShareMessage, sharePublicAddress } from './public-address-actions';
import { createReceiveQrPayload, receivingAddress, receivingExplorer, receivingNetworks, receiveNetworkStatus,
  RECEIVE_QR_ERROR_CORRECTION, RECEIVE_QR_QUIET_ZONE, RECEIVE_QR_SIZE } from './receive.logic';
import { shortPublicAddress } from './WalletHomeShell.logic';

function Action({ label, icon, onPress, disabled = false, caption }: {
  label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; disabled?: boolean; caption?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, { opacity: disabled ? 0.35 : pressed ? 0.7 : 1 }]}>
    <Ionicons name={icon} size={20} color={colors.cyan} />
    {caption && <Text style={styles.link}>{caption}</Text>}
  </Pressable>;
}

export function ReceiveScreen({ wallet, registry }: { wallet: Wallet; registry: NetworkRegistry }) {
  const account = wallet.accounts[0];
  return <AddressList key={JSON.stringify([wallet.walletId, account?.accountId, account?.address])}
    accountName={account ? `Account ${account.index + 1}` : 'Account unavailable'}
    address={account?.address ?? ''} registry={registry} />;
}

function AddressList({ accountName, address, registry }: { accountName: string; address: string; registry: NetworkRegistry }) {
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [qrFailed, setQrFailed] = useState(false);
  const networks = receivingNetworks(registry.listNetworks());
  const network = networks.find(item => item.id === sheetId);
  const payload = network && createReceiveQrPayload(receivingAddress(network, address) ?? '');
  const explorer = network && receivingExplorer(network, address);

  async function copy(item: EvmNetwork) {
    const value = receivingAddress(item, address);
    if (!value) return;
    try {
      await copyPublicAddress(value);
      setNotice(`${item.displayName} address copied`);
    } catch {
      setNotice('Could not copy the address. Try again.');
    }
  }

  return <>
    <ScrollView accessibilityLabel="Receive screen" contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>Receiving addresses</Text>
      <Text style={styles.account}>{accountName}</Text>
      <Text style={styles.note}>Use the same public address on each supported EVM network.</Text>
      {networks.map(item => {
        const value = receivingAddress(item, address);
        const planned = item.id === 'primewave' && !receiveNetworkStatus(item).configured;
        return <View key={item.id} style={styles.row}>
          <WalletLogo networkId={item.id} />
          <View style={styles.identity}><Text style={styles.name}>{item.displayName}</Text>
            <Text style={styles.note}>{planned ? 'Planned · Unavailable' : value ? shortPublicAddress(value) : 'Address unavailable'}</Text>
          </View>
          <Action label={`Copy ${item.displayName} receiving address`} icon="copy-outline" disabled={!value} onPress={() => void copy(item)} />
          <Action label={`Show ${item.displayName} QR code`} icon="qr-code-outline" disabled={!value}
            onPress={() => { setNotice(''); setQrFailed(false); setSheetId(item.id); }} />
        </View>;
      })}
      {!sheetId && !!notice && <Text accessibilityLiveRegion="polite" style={styles.link}>{notice}</Text>}
    </ScrollView>
    <WaveXBottomSheet visible={!!payload} title={network ? `${accountName} · ${network.displayName}` : accountName} onClose={() => { setSheetId(null); setNotice(''); }}>
      {network && payload && <>
        <View accessible accessibilityLabel={`QR code for ${payload}`} style={styles.qr}>
          {qrFailed ? <Text>QR unavailable</Text> : <QRCode value={payload} size={RECEIVE_QR_SIZE} quietZone={RECEIVE_QR_QUIET_ZONE}
            ecl={RECEIVE_QR_ERROR_CORRECTION} color="#090B0E" backgroundColor="#ffffff" onError={() => setQrFailed(true)} />}
        </View>
        <View style={styles.actions}><WalletLogo networkId={network.id} size={24} /><Text accessibilityRole="header" style={styles.name}>{network.displayName} receiving address</Text></View>
        <Text style={styles.note}>Ask the sender to use {network.displayName}. Sending on a different network may result in lost funds.</Text>
        <Text selectable accessibilityLabel="Full public address" style={styles.address}>{payload}</Text>
        <View style={styles.actions}>
          <Action label={`Copy ${network.displayName} address from QR sheet`} caption="Copy address" icon="copy-outline" onPress={() => void copy(network)} />
          <Action label="Share address" caption="Share" icon="share-outline" onPress={async () => {
            if (await sharePublicAddress(createPublicAddressShareMessage(network, payload)) === 'unavailable') setNotice('Sharing unavailable. Use Copy address.');
          }} />
        </View>
        {explorer && <Action label="View in Explorer" caption="View in Explorer" icon="open-outline"
          onPress={() => void Linking.openURL(explorer).catch(() => setNotice('Could not open explorer.'))} />}
        {!!notice && <Text accessibilityLiveRegion="polite" style={styles.link}>{notice}</Text>}
      </>}
    </WaveXBottomSheet>
  </>;
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 6 },
  title: { fontSize: 26, color: colors.text, fontFamily: 'Inter_700Bold' },
  account: { fontSize: 16, color: colors.text, fontFamily: 'Inter_600SemiBold', marginTop: 4 },
  note: { color: colors.secondaryText, fontSize: 13, lineHeight: 19 },
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.divider },
  badge: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  identity: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  action: { minWidth: 44, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  actions: { flexDirection: 'row', gap: 20 },
  link: { color: colors.cyan, fontSize: 13 },
  qr: { alignSelf: 'center', padding: 10, borderRadius: 12, backgroundColor: '#ffffff' },
  address: { color: colors.text, fontSize: 15, lineHeight: 22 },
});
