import { decodeFunctionData } from 'viem';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { theme } from '@/src/theme';
import type { DAppTransactionRequest } from '@/src/core/dapp';
import {
  assertDAppTransactionBinding,
  createDAppTransactionBinding,
  type DAppTransactionBinding,
} from '@/src/core/dapp';
import type { EvmNetwork, NetworkRegistry } from '@/src/core/networks';
import type { Wallet } from '@/src/core/wallet/models';
import type {
  TransactionIntent,
  TransactionPreview,
} from '@/src/core/transactions/construction';
import {
  createTransactionSigningAuthorization,
  type SignedTransaction,
} from '@/src/core/transactions/signing';
import type {
  BroadcastResult,
  ConfirmationResult,
} from '@/src/core/transactions/broadcast';
import { TransactionBroadcastError } from '@/src/core/transactions/broadcast';
import type {
  AuthenticationResult,
  BiometricAvailability,
} from '@/src/core/security';
import type {
  TransactionActivityDependency,
  TransactionConstructionDependency,
  TransactionSigningDependency,
} from '@/src/components/TransactionReviewScreen.logic';
import { activityDirection, activityTransactionTypeFor } from '@/src/core/activity';
import { formatNativeUnits } from '@/src/core/blockchain/gas-fee';
import { normalizePublicEvmAddress } from '@/src/core/blockchain/account-state';

const ERC20_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
  },
] as const;

type DecodedCall =
  | { readonly kind: 'transfer'; readonly recipient: string; readonly amount: bigint }
  | { readonly kind: 'approve'; readonly spender: string; readonly amount: bigint }
  | { readonly kind: 'unknown' };

function decodeCall(data: `0x${string}`): DecodedCall {
  if (data === '0x') return { kind: 'unknown' };
  try {
    const decoded = decodeFunctionData({ abi: ERC20_ABI, data });
    const args = decoded.args;
    if (!args) return { kind: 'unknown' };
    const first = args[0];
    const second = args[1];
    if (decoded.functionName === 'transfer' && typeof first === 'string' && typeof second === 'bigint') {
      return { kind: 'transfer', recipient: normalizePublicEvmAddress(first), amount: second };
    }
    if (decoded.functionName === 'approve' && typeof first === 'string' && typeof second === 'bigint') {
      return { kind: 'approve', spender: normalizePublicEvmAddress(first), amount: second };
    }
  } catch {
    // Unknown calldata stays neutral and is shown as bounded raw data.
  }
  return { kind: 'unknown' };
}

function short(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function intentFor(request: DAppTransactionRequest): TransactionIntent {
  const payload = request.payload;
  return {
    networkId: request.networkId,
    from: payload.from,
    to: payload.to,
    value: payload.value,
    data: payload.calldata,
    nonce: payload.nonce ?? undefined,
    gasLimit: payload.gasLimit ?? undefined,
    transactionType: payload.calldata === '0x' ? 'native-transfer' : 'contract-call',
    fee: {
      preference: payload.feePreference,
      gasPrice: payload.gasPrice ?? undefined,
      maxFeePerGas: payload.maxFeePerGas ?? undefined,
      maxPriorityFeePerGas: payload.maxPriorityFeePerGas ?? undefined,
    },
  };
}

function stale(
  request: DAppTransactionRequest,
  network: EvmNetwork,
  wallet: Wallet,
): void {
  const account = wallet.accounts[0];
  if (
    !account ||
    account.accountId !== request.accountId ||
    normalizePublicEvmAddress(account.address) !==
      normalizePublicEvmAddress(request.payload.from) ||
    network.id !== request.networkId ||
    network.chainId === null ||
    BigInt(network.chainId) !== request.chainId
  ) {
    throw new Error('The wallet, account, or network changed. Review the request again.');
  }
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text selectable style={styles.value}>{value}</Text>
    </View>
  );
}

export function DAppTransactionReviewScreen({
  request,
  wallet,
  network,
  networkRegistry,
  createConstructionEngine,
  createSigningDependency,
  createBroadcastDependency,
  getNativeBalance,
  getTokenBalance,
  activityService,
  onReject,
  onCompleted,
  onFailed,
  onDone,
}: {
  readonly request: DAppTransactionRequest;
  readonly wallet: Wallet;
  readonly network: EvmNetwork;
  readonly networkRegistry: NetworkRegistry;
  readonly createConstructionEngine: (
    wallet: Wallet,
    networkId: string,
  ) => Promise<TransactionConstructionDependency | null>;
  readonly createSigningDependency: (
    wallet: Wallet,
    networkId: string,
  ) => Promise<TransactionSigningDependency | null>;
  readonly createBroadcastDependency: (
    networkId: string,
  ) => Promise<{
    readonly broadcast: (signed: SignedTransaction) => Promise<BroadcastResult>;
    readonly confirm: (broadcast: BroadcastResult) => Promise<ConfirmationResult>;
  } | null>;
  readonly getNativeBalance: (networkId: string, address: string) => Promise<bigint>;
  readonly getTokenBalance: (
    networkId: string,
    tokenAddress: string,
    owner: string,
  ) => Promise<bigint>;
  readonly activityService?: TransactionActivityDependency | null;
  readonly onReject: () => void;
  readonly onCompleted: (hash: `0x${string}`) => void;
  readonly onFailed: (code: 'EXECUTION_FAILED' | 'STALE_REQUEST' | 'UNKNOWN_RESULT') => void;
  readonly onDone: () => void;
}) {
  const [engine, setEngine] = useState<TransactionConstructionDependency | null>(null);
  const [signing, setSigning] = useState<TransactionSigningDependency | null>(null);
  const [broadcast, setBroadcast] = useState<Awaited<ReturnType<typeof createBroadcastDependency>>>(null);
  const [preview, setPreview] = useState<TransactionPreview | null>(null);
  const [binding, setBinding] = useState<DAppTransactionBinding | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'auth' | 'signing' | 'broadcasting' | 'confirming' | 'done' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [biometric, setBiometric] = useState<BiometricAvailability>({ available: false, type: null });
  const [signed, setSigned] = useState<SignedTransaction | null>(null);
  const [broadcastResult, setBroadcastResult] = useState<BroadcastResult | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [activityLocalTransactionId, setActivityLocalTransactionId] = useState<string | null>(null);
  const decoded = useMemo(() => decodeCall(request.payload.calldata), [request.payload.calldata]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      createConstructionEngine(wallet, request.networkId),
      createSigningDependency(wallet, request.networkId),
      createBroadcastDependency(request.networkId),
    ])
      .then(async ([nextEngine, nextSigning, nextBroadcast]) => {
        if (cancelled) return;
        if (!nextEngine || !nextSigning || !nextBroadcast) {
          throw new Error('Secure transaction execution is unavailable on this device.');
        }
        stale(request, network, wallet);
        const nextPreview = await nextEngine.construct(intentFor(request));
        if (cancelled) return;
        const balance = await getNativeBalance(request.networkId, request.payload.from);
        if (nextPreview.totalMaximumNativeAmount > balance) {
          throw new Error('The native balance does not cover the value and maximum network fee.');
        }
        if (decoded.kind === 'transfer') {
          const tokenBalance = await getTokenBalance(
            request.networkId,
            request.payload.to,
            request.payload.from,
          );
          if (decoded.amount > tokenBalance) {
            throw new Error('The token balance does not cover this transfer.');
          }
        }
        setEngine(nextEngine);
        setSigning(nextSigning);
        setBroadcast(nextBroadcast);
        setPreview(nextPreview);
        setBinding(createDAppTransactionBinding(request, nextPreview.unsignedTransaction));
        setState('ready');
      })
      .catch((nextError: unknown) => {
        if (cancelled) return;
        setError(nextError instanceof Error ? nextError.message : 'The transaction request is unavailable.');
        setState('error');
        onFailed('EXECUTION_FAILED');
      });
    return () => { cancelled = true; };
  }, [createBroadcastDependency, createConstructionEngine, createSigningDependency, decoded.kind, getNativeBalance, getTokenBalance, network, request, wallet]);

  useEffect(() => {
    if (state !== 'auth' || !signing) return;
    let cancelled = false;
    void signing.getBiometricAvailability().then((result) => {
      if (!cancelled) setBiometric(result);
    }).catch(() => {
      if (!cancelled) setBiometric({ available: false, type: null });
    });
    return () => { cancelled = true; };
  }, [signing, state]);

  useEffect(() => {
    if (state !== 'broadcasting' || !broadcastResult || !broadcast) return;
    let cancelled = false;
    setState('confirming');
    void broadcast.confirm(broadcastResult).then((result) => {
      if (cancelled) return;
      setConfirmation(result);
      if (activityService && activityLocalTransactionId) {
        activityService.recordConfirmation(activityLocalTransactionId, result);
      }
      setState('done');
    }).catch(() => {
      if (!cancelled) setState('done');
    });
    return () => { cancelled = true; };
  }, [activityLocalTransactionId, activityService, broadcast, broadcastResult, state]);

  const authenticateAndSign = async (method: 'pin' | 'biometric') => {
    if (!signing || !engine || !preview || !binding || state !== 'auth') return;
    setState('signing');
    setError(null);
    try {
      const authentication: AuthenticationResult =
        method === 'pin'
          ? await signing.authenticateWithPin(pin)
          : await signing.authenticateWithBiometrics();
      setPin('');
      if (!authentication.authenticated) {
        setState('auth');
        setError(authentication.reason === 'cancelled' ? 'Authentication was cancelled.' : 'Authentication was not accepted.');
        return;
      }
      stale(request, network, wallet);
      const latest = await engine.construct(intentFor(request));
      assertDAppTransactionBinding(binding, request, latest.unsignedTransaction);
      const balance = await getNativeBalance(request.networkId, request.payload.from);
      if (latest.totalMaximumNativeAmount > balance) throw new Error('The available balance changed and is no longer sufficient.');
      if (decoded.kind === 'transfer') {
        const tokenBalance = await getTokenBalance(
          request.networkId,
          request.payload.to,
          request.payload.from,
        );
        if (decoded.amount > tokenBalance) {
          throw new Error('The token balance changed and is no longer sufficient.');
        }
      }
      const authorization = createTransactionSigningAuthorization({
        accountId: request.accountId,
        requestId: request.requestId,
        transaction: latest.unsignedTransaction,
      });
      const nextSigned = await signing.sign(latest.unsignedTransaction, authorization);
      setPreview(latest);
      setSigned(nextSigned);
      setState('broadcasting');
      if (!broadcast) throw new Error('Transaction broadcast is unavailable on this device.');
      const result = await broadcast.broadcast(nextSigned);
      setBroadcastResult(result);
      try {
        if (activityService) {
          const activity = activityService.createDraft({
            accountId: request.accountId,
            senderAddress: nextSigned.from,
            networkId: request.networkId,
            chainId: request.chainId,
            transactionType:
              request.payload.calldata === '0x'
                ? 'native-transfer'
                : decoded.kind === 'transfer'
                  ? activityTransactionTypeFor('fungible_token', true)
                  : 'contract-interaction',
            direction: activityDirection(nextSigned.from, request.payload.to),
            recipient: request.payload.to,
            nativeValue: request.payload.value,
            amountRaw: decoded.kind === 'transfer' ? decoded.amount : request.payload.value,
            amountDecimals: null,
            amountDisplay: null,
            tokenContractAddress: request.payload.calldata === '0x' ? null : request.payload.to,
            nonce: latest.unsignedTransaction.nonce,
            gasLimit: latest.unsignedTransaction.gasLimit,
            feeModel: latest.feeModel,
            feeAmount: latest.estimatedNetworkFee,
          });
          setActivityLocalTransactionId(activity.localTransactionId);
          activityService.recordBroadcast(activity.localTransactionId!, result);
        }
      } catch {
        setError('The transaction was broadcast, but Activity could not be updated.');
      }
      if (result.state === 'unknown') {
        onFailed('UNKNOWN_RESULT');
        setState('done');
        return;
      }
      onCompleted(result.transactionHash);
    } catch (nextError: unknown) {
      setState('error');
      setError(nextError instanceof Error ? nextError.message : 'The transaction could not be executed.');
      if (
        nextError instanceof TransactionBroadcastError &&
        nextError.code === 'BROADCAST_UNKNOWN_RESULT'
      ) {
        setState('done');
        onFailed('UNKNOWN_RESULT');
      } else {
        onFailed(nextError instanceof Error && nextError.message.includes('stale') ? 'STALE_REQUEST' : 'EXECUTION_FAILED');
      }
    }
  };

  if (state === 'loading') {
    return <View style={styles.center}><ActivityIndicator color={theme.colors.accent} /><Text style={styles.body}>Preparing secure transaction review…</Text></View>;
  }
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.eyebrow}>DAPP TRANSACTION REQUEST</Text>
      <Text style={styles.title}>Review before signing</Text>
      <Text style={styles.body}>This request will use the existing WAVEX authentication, signing, broadcast, and confirmation path.</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>DApp</Text>
        <Row label="Name" value={request.identity.name} />
        <Row label="Domain" value={request.identity.url} />
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Account and network</Text>
        <Row label="Account" value={`${request.accountId} · ${short(request.payload.from)}`} />
        <Row label="Network" value={`${network.displayName} · Chain ${request.chainId.toString()}`} />
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{decoded.kind === 'unknown' ? 'Contract interaction' : decoded.kind === 'approve' ? 'Token approval' : 'Token transfer'}</Text>
        <Row label="Destination" value={short(request.payload.to)} />
        <Row label="Native value" value={`${formatNativeUnits(request.payload.value, network.nativeCurrency.decimals)} ${network.nativeCurrency.symbol}`} />
        {decoded.kind === 'transfer' ? <Row label="Recipient" value={short(decoded.recipient)} /> : null}
        {decoded.kind === 'approve' ? <Row label="Spender" value={short(decoded.spender)} /> : null}
        {decoded.kind !== 'unknown' ? <Row label="Token amount" value={decoded.amount.toString()} /> : null}
        {decoded.kind === 'unknown' ? <Row label="Calldata" value={request.payload.calldata.slice(0, 130) + (request.payload.calldata.length > 130 ? '…' : '')} /> : null}
        <Text style={styles.warning}>Metadata and DApp identity are not proof that this contract or spender is trusted.</Text>
      </View>
      {preview ? <View style={styles.card}>
        <Text style={styles.cardTitle}>Fees</Text>
        <Row label="Gas limit" value={preview.gasLimit.toString()} />
        <Row label="Fee model" value={preview.feeModel === 'eip1559' ? 'EIP-1559' : 'Legacy'} />
        <Row label="Estimated fee" value={`${preview.estimatedNetworkFeeDisplay} ${preview.symbol}`} />
        <Row label="Maximum total" value={`${preview.totalMaximumNativeAmountDisplay} ${preview.symbol}`} />
        <Text style={styles.warning}>{preview.warnings.join(' ') || 'Review the exact transaction details before confirming.'}</Text>
      </View> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {state === 'auth' ? <View style={styles.card}>
        <Text style={styles.cardTitle}>Authenticate this exact request</Text>
        <TextInput
          autoComplete="off"
          keyboardType="number-pad"
          maxLength={6}
          onChangeText={setPin}
          placeholder="Six-digit PIN"
          secureTextEntry
          style={styles.input}
          value={pin}
        />
        <Pressable onPress={() => void authenticateAndSign('pin')} style={styles.primary}><Text style={styles.primaryText}>Authenticate and sign</Text></Pressable>
        {biometric.available ? <Pressable onPress={() => void authenticateAndSign('biometric')} style={styles.secondary}><Text style={styles.secondaryText}>Use biometrics</Text></Pressable> : null}
      </View> : null}
      {state === 'ready' ? <Pressable onPress={() => setState('auth')} style={styles.primary}><Text style={styles.primaryText}>Confirm Transaction</Text></Pressable> : null}
      {state === 'signing' || state === 'broadcasting' || state === 'confirming' ? <View style={styles.center}><ActivityIndicator color={theme.colors.accent} /><Text style={styles.body}>{state === 'signing' ? 'Signing…' : state === 'broadcasting' ? 'Broadcasting…' : 'Confirming…'}</Text></View> : null}
      {state === 'done' ? <View style={styles.card}><Text style={styles.cardTitle}>{confirmation?.state === 'reverted' ? 'Transaction reverted' : 'Transaction submitted'}</Text><Text style={styles.body}>{signed?.transactionHash ?? 'The result is being reconciled. Do not rebroadcast automatically.'}</Text></View> : null}
      {state === 'ready' || state === 'auth' ? <Pressable onPress={onReject} style={styles.secondary}><Text style={styles.secondaryText}>Reject</Text></Pressable> : null}
      {state === 'done' || state === 'error' ? <Pressable onPress={onDone} style={styles.secondary}><Text style={styles.secondaryText}>Done</Text></Pressable> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 22, gap: 14, paddingBottom: 48 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  eyebrow: { color: theme.colors.accent, fontSize: 12, fontWeight: '700', letterSpacing: 1.4 },
  title: { color: theme.colors.foreground, fontSize: 28, fontWeight: '800' },
  body: { color: theme.colors.mutedForeground, fontSize: 14, lineHeight: 21 },
  card: { backgroundColor: theme.colors.card, borderColor: theme.colors.border, borderRadius: 18, borderWidth: 1, gap: 10, padding: 16 },
  cardTitle: { color: theme.colors.foreground, fontSize: 16, fontWeight: '800' },
  row: { flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  label: { color: theme.colors.mutedForeground, flex: 1, fontSize: 13 },
  value: { color: theme.colors.foreground, flex: 2, fontSize: 13, textAlign: 'right' },
  warning: { color: theme.states.warning, fontSize: 12, lineHeight: 18 },
  error: { color: theme.colors.destructive, fontSize: 14, lineHeight: 20 },
  input: { borderColor: theme.colors.border, borderRadius: 12, borderWidth: 1, color: theme.colors.foreground, padding: 13 },
  primary: { alignItems: 'center', backgroundColor: theme.colors.accent, borderRadius: 14, padding: 15 },
  primaryText: { color: theme.colors.primaryForeground, fontSize: 15, fontWeight: '800' },
  secondary: { alignItems: 'center', borderColor: theme.colors.border, borderRadius: 14, borderWidth: 1, padding: 14 },
  secondaryText: { color: theme.colors.foreground, fontSize: 15, fontWeight: '700' },
});