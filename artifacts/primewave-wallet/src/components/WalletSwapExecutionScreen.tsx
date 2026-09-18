import { Ionicons } from '@expo/vector-icons';
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
import type { EvmNetwork, NetworkRegistry } from '@/src/core/networks';
import type { PortfolioReadModel } from '@/src/core/portfolio';
import type { Wallet } from '@/src/core/wallet/models';
import {
  createTransactionSigningAuthorization,
  type SignedTransaction,
} from '@/src/core/transactions/signing';
import type {
  BroadcastResult,
  ConfirmationResult,
} from '@/src/core/transactions/broadcast';
import {
  SwapExecutionError,
  SwapExecutionService,
  SwapReviewService,
  type SwapExecutionPlan,
  type SwapReviewApproval,
  type SwapReviewInput,
  type SwapReviewSnapshot,
  type SwapQuote,
  type SwapQuoteLifecycleState,
} from '@/src/core/swaps';
import type {
  TransactionBroadcastDependency,
  TransactionConstructionDependency,
  TransactionSigningDependency,
} from './TransactionReviewScreen.logic';
import {
  formatReviewFee,
  reviewFeeAssetLabel,
} from './WalletSwapReviewScreen.logic';

type ExecutionState =
  | 'loading'
  | 'ready'
  | 'approval-review'
  | 'approval-auth'
  | 'approval-signing'
  | 'approval-signed'
  | 'approval-broadcasting'
  | 'approval-confirming'
  | 'approval-confirmed'
  | 'swap-review'
  | 'swap-auth'
  | 'swap-signing'
  | 'swap-signed'
  | 'swap-broadcasting'
  | 'swap-confirming'
  | 'completed'
  | 'failed'
  | 'unknown';

function shortAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function SectionCard({
  eyebrow,
  children,
  warning = false,
}: {
  readonly eyebrow: string;
  readonly children: React.ReactNode;
  readonly warning?: boolean;
}) {
  return (
    <View style={[styles.card, warning && styles.warningCard]}>
      <Text style={styles.cardEyebrow}>{eyebrow}</Text>
      {children}
    </View>
  );
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text selectable style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function stageLabel(state: ExecutionState): string {
  if (state.startsWith('approval')) return 'APPROVAL';
  if (state.startsWith('swap') || state === 'completed') return 'SWAP EXECUTION';
  return 'EXECUTION';
}

export function WalletSwapExecutionScreen({
  quote,
  quoteService,
  review,
  approval,
  wallet,
  network,
  networkRegistry,
  portfolio,
  previewMode,
  createConstructionEngine,
  createSigningDependency,
  createBroadcastDependency,
  onBack,
}: {
  readonly quote: SwapQuote;
  readonly quoteService: import('@/src/core/swaps').SwapQuoteService | null;
  readonly review: SwapReviewSnapshot;
  readonly approval: SwapReviewApproval;
  readonly wallet: Wallet;
  readonly network: EvmNetwork;
  readonly networkRegistry: NetworkRegistry;
  readonly portfolio: PortfolioReadModel | null;
  readonly previewMode: boolean;
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
  ) => Promise<TransactionBroadcastDependency | null>;
  readonly onBack: () => void;
}) {
  const account = wallet.accounts[0];
  const reviewService = useMemo(
    () => new SwapReviewService(networkRegistry),
    [networkRegistry],
  );
  const executionService = useMemo(
    () => new SwapExecutionService(reviewService),
    [reviewService],
  );
  const currentInput = useMemo<SwapReviewInput>(() => {
    const sellAsset = portfolio?.assets.find(
      (asset) =>
        asset.identity.networkId === quote.sellAsset.networkId &&
        asset.identity.assetType === quote.sellAsset.assetType &&
        asset.identity.assetId === quote.sellAsset.assetId,
    ) ?? null;
    const buyAsset = portfolio?.assets.find(
      (asset) =>
        asset.identity.networkId === quote.buyAsset.networkId &&
        asset.identity.assetType === quote.buyAsset.assetType &&
        asset.identity.assetId === quote.buyAsset.assetId,
    ) ?? null;
    return {
      quote,
      quoteLifecycleState: (quoteService?.getLifecycle().state ?? 'quoted') as SwapQuoteLifecycleState,
      account: {
        accountId: account?.accountId ?? '',
        address: account?.address ?? '',
      },
      network,
      registeredNetwork: networkRegistry.getById(network.id),
      activeNetworkId: networkRegistry.getActiveNetwork()?.id ?? null,
      sellAsset,
      buyAsset,
      portfolio,
    };
  }, [account?.accountId, account?.address, network, networkRegistry, portfolio, quote, quoteService]);
  const [constructionEngine, setConstructionEngine] =
    useState<TransactionConstructionDependency | null>(null);
  const [signingDependency, setSigningDependency] =
    useState<TransactionSigningDependency | null>(null);
  const [broadcastDependency, setBroadcastDependency] =
    useState<TransactionBroadcastDependency | null>(null);
  const [plan, setPlan] = useState<SwapExecutionPlan | null>(null);
  const [state, setState] = useState<ExecutionState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [signedTransaction, setSignedTransaction] = useState<SignedTransaction | null>(null);
  const [broadcastResult, setBroadcastResult] = useState<BroadcastResult | null>(null);
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!account || previewMode) {
      setState('failed');
      setErrorMessage(
        previewMode
          ? 'Preview Test Mode cannot execute a swap.'
          : 'The active public account is unavailable.',
      );
      return () => {
        cancelled = true;
      };
    }
    void Promise.all([
      createConstructionEngine(wallet, review.networkId),
      createSigningDependency(wallet, review.networkId),
      createBroadcastDependency(review.networkId),
    ]).then(([nextEngine, nextSigning, nextBroadcast]) => {
      if (cancelled) return;
      setConstructionEngine(nextEngine);
      setSigningDependency(nextSigning);
      setBroadcastDependency(nextBroadcast);
      setState('ready');
    }).catch(() => {
      if (!cancelled) {
        setState('failed');
        setErrorMessage('The execution services are unavailable.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    account,
    createBroadcastDependency,
    createConstructionEngine,
    createSigningDependency,
    previewMode,
    review.networkId,
    wallet,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!signingDependency || (state !== 'approval-auth' && state !== 'swap-auth')) {
      setBiometricAvailable(false);
      return () => {
        cancelled = true;
      };
    }
    void signingDependency.getBiometricAvailability().then((availability) => {
      if (!cancelled) setBiometricAvailable(availability.available);
    }).catch(() => {
      if (!cancelled) setBiometricAvailable(false);
    });
    return () => {
      cancelled = true;
    };
  }, [signingDependency, state]);

  useEffect(() => {
    let cancelled = false;
    if (
      state !== 'approval-broadcasting' &&
      state !== 'swap-broadcasting'
    ) {
      return () => {
        cancelled = true;
      };
    }
    if (!broadcastResult || broadcastResult.state !== 'broadcasted' || !broadcastDependency) {
      if (broadcastResult?.state === 'unknown') {
        setState('unknown');
      }
      return () => {
        cancelled = true;
      };
    }
    setState(state === 'approval-broadcasting' ? 'approval-confirming' : 'swap-confirming');
    void broadcastDependency.confirm(broadcastResult).then((result) => {
      if (cancelled) return;
      setConfirmationResult(result);
      if (result.state === 'unknown') {
        setState('unknown');
        setErrorMessage('Confirmation status is unknown. Do not rebroadcast automatically.');
      } else if (state === 'approval-broadcasting') {
        setState(result.state === 'confirmed' ? 'approval-confirmed' : 'failed');
        if (result.state !== 'confirmed') {
          setErrorMessage('The approval did not confirm. The swap was not submitted.');
        }
      } else {
        setState(result.state === 'confirmed' ? 'completed' : 'failed');
        if (result.state !== 'confirmed') {
          setErrorMessage('The swap transaction reverted. No automatic retry was performed.');
        }
      }
    }).catch(() => {
      if (!cancelled) {
        setState('unknown');
        setErrorMessage('Confirmation status is unknown. Do not rebroadcast automatically.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [broadcastDependency, broadcastResult, state]);

  const preparePlan = async (): Promise<SwapExecutionPlan | null> => {
    if (!account || !constructionEngine || previewMode) return null;
    setErrorMessage(null);
    try {
      const nextPlan = await executionService.prepare({
        review,
        approval,
        current: currentInput,
        accountId: account.accountId,
        network,
        activeNetworkId: networkRegistry.getActiveNetwork()?.id ?? null,
        constructionEngine,
      });
      setPlan(nextPlan);
      return nextPlan;
    } catch (error: unknown) {
      setState('failed');
      setErrorMessage(
        error instanceof SwapExecutionError
          ? error.message
          : 'The approved swap is no longer executable.',
      );
      return null;
    }
  };

  const beginExecution = async () => {
    const nextPlan = plan ?? await preparePlan();
    if (!nextPlan) return;
    setState(nextPlan.approvalRequired ? 'approval-review' : 'swap-review');
  };

  const finalPlan = async (): Promise<SwapExecutionPlan | null> => {
    const nextPlan = await preparePlan();
    if (!nextPlan || !plan) return nextPlan;
    const expected = state === 'approval-auth'
      ? nextPlan.approvalTransaction?.unsignedTransaction.canonicalRepresentation
      : nextPlan.swapTransaction.unsignedTransaction.canonicalRepresentation;
    const original = state === 'approval-auth'
      ? plan.approvalTransaction?.unsignedTransaction.canonicalRepresentation
      : plan.swapTransaction.unsignedTransaction.canonicalRepresentation;
    if (!expected || expected !== original) {
      setState('failed');
      setErrorMessage('The final transaction checkpoint changed. Nothing was signed.');
      return null;
    }
    return nextPlan;
  };

  const authenticateAndSign = async (method: 'pin' | 'biometric') => {
    if (!signingDependency || !plan || !account) return;
    const approvalSigning = state === 'approval-auth';
    setErrorMessage(null);
    const enteredPin = pin;
    setPin('');
    try {
      const authentication = method === 'pin'
        ? await signingDependency.authenticateWithPin(enteredPin)
        : await signingDependency.authenticateWithBiometrics();
      if (!authentication.authenticated) {
        setErrorMessage('Authentication was not completed.');
        return;
      }
      const latest = await finalPlan();
      if (!latest) return;
      const transaction = approvalSigning
        ? latest.approvalTransaction?.unsignedTransaction
        : latest.swapTransaction.unsignedTransaction;
      if (!transaction) {
        setState('failed');
        setErrorMessage('The required transaction review is unavailable.');
        return;
      }
      if (approvalSigning) executionService.assertApprovalStillBound(latest, latest.approvalTransaction!);
      else executionService.assertSwapStillBound(latest, latest.swapTransaction);
      setState(approvalSigning ? 'approval-signing' : 'swap-signing');
      const authorization = createTransactionSigningAuthorization({
        accountId: account.accountId,
        transaction,
        requestId: `wavex-swap-${approvalSigning ? 'approval' : 'execution'}:${latest.review.reviewDigest}`,
      });
      const signed = await signingDependency.sign(transaction, authorization);
      setSignedTransaction(signed);
      setState(approvalSigning ? 'approval-signed' : 'swap-signed');
    } catch (error: unknown) {
      setState(approvalSigning ? 'approval-auth' : 'swap-auth');
      setErrorMessage(error instanceof Error ? error.message : 'The transaction could not be signed.');
    }
  };

  const broadcastSigned = async () => {
    if (!signedTransaction || !broadcastDependency) return;
    const approvalBroadcast = state === 'approval-signed';
    setState(approvalBroadcast ? 'approval-broadcasting' : 'swap-broadcasting');
    setErrorMessage(null);
    try {
      const result = await broadcastDependency.broadcast(signedTransaction);
      setBroadcastResult(result);
      if (result.state === 'unknown') {
        setState('unknown');
        setErrorMessage('Broadcast status is unknown. Do not rebroadcast automatically.');
      }
    } catch (error: unknown) {
      setState('failed');
      setErrorMessage(error instanceof Error ? error.message : 'Broadcast failed. No automatic retry was performed.');
    }
  };

  const headerTitle =
    state === 'completed'
      ? 'Swap completed'
      : state === 'unknown'
        ? 'Execution status unknown'
        : state === 'failed'
          ? 'Execution stopped'
          : state === 'approval-confirmed'
            ? 'Approval confirmed'
            : 'Continue securely';
  const busy = state.endsWith('signing') || state.endsWith('broadcasting') || state.endsWith('confirming');
  const networkFee = plan
    ? formatReviewFee(
        plan.swapTransaction.feeModel === 'legacy'
          ? { amount: plan.swapTransaction.estimatedNetworkFee, asset: { assetType: 'native', networkId: network.id, assetId: 'native' } }
          : { amount: plan.swapTransaction.estimatedNetworkFee, asset: { assetType: 'native', networkId: network.id, assetId: 'native' } },
        network,
        review.sellAsset,
        review.buyAsset,
      )
    : null;

  if (state === 'loading') {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator color={theme.colors.accent} size="large" />
        <Text style={styles.stateTitle}>Preparing execution boundary</Text>
        <Text style={styles.stateBody}>Checking the approved review and local transaction services.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>{stageLabel(state)}</Text>
        <Text style={styles.title}>{headerTitle}</Text>
        <Text style={styles.body}>
          {state === 'approval-confirmed'
            ? 'The token permission confirmed separately. Continue only when you are ready to authorize the swap transaction.'
            : state === 'completed'
              ? 'The swap confirmation was observed on the selected network.'
              : state === 'unknown'
                ? 'The network result is ambiguous. Do not sign or broadcast this transaction again automatically.'
                : 'Every signing and broadcast action is explicit. The provider calldata is never replaced.'}
        </Text>
      </View>
      <SectionCard eyebrow="REVIEW BINDING">
        <DetailRow label="Quote" value={`${review.providerId} • ${review.quoteId}`} />
        <DetailRow label="Network" value={`${review.networkId} • Chain ${review.chainId.toString()}`} />
        <DetailRow label="Sender" value={shortAddress(review.senderAddress)} />
        <DetailRow label="Review digest" value={review.reviewDigest} />
      </SectionCard>
      {plan?.approvalRequired && plan.approvalTransaction ? (
        <SectionCard eyebrow="APPROVAL TRANSACTION" warning>
          <Text style={styles.warningTitle}>This grants token spending permission</Text>
          <DetailRow label="Token contract" value={shortAddress(review.sellAsset.contractAddress ?? '')} />
          <DetailRow label="Approval target" value={shortAddress(review.allowanceRequirement?.spender ?? '')} />
          <DetailRow label="Exact approval amount" value={`${review.sellAmountDisplay} ${review.sellAsset.symbol ?? 'token'}`} />
          <DetailRow label="Network fee" value={networkFee ? `${networkFee} ${network.nativeCurrency.symbol}` : 'Available in transaction review'} />
        </SectionCard>
      ) : null}
      {plan && !plan.approvalRequired ? (
        <SectionCard eyebrow="SWAP TRANSACTION">
          <DetailRow label="Target" value={shortAddress(review.transactionRequest.to)} />
          <DetailRow label="Native value" value={`${review.transactionRequest.value.toString()} wei`} />
          <DetailRow label="Calldata" value={`${(review.transactionRequest.data.length - 2) / 2} bytes`} />
          <DetailRow label="Network fee" value={networkFee ? `${networkFee} ${network.nativeCurrency.symbol}` : 'Available in transaction review'} />
        </SectionCard>
      ) : null}
      {state === 'approval-review' && plan?.approvalTransaction ? (
        <ActionButton label="Confirm token approval" onPress={() => setState('approval-auth')} />
      ) : null}
      {state === 'ready' ? (
        <ActionButton label={review.allowanceState === 'insufficient' ? 'Review token approval' : 'Review swap execution'} onPress={() => void beginExecution()} disabled={busy} />
      ) : null}
      {state === 'approval-confirmed' ? (
        <ActionButton label="Continue to swap execution" onPress={() => setState('swap-review')} />
      ) : null}
      {state === 'swap-review' ? (
        <ActionButton label="Confirm swap execution" onPress={() => setState('swap-auth')} />
      ) : null}
      {state === 'approval-auth' || state === 'swap-auth' ? (
        <SectionCard eyebrow="AUTHENTICATION" warning>
          <Text style={styles.body}>Authenticate immediately before local signing. The approval and swap each require a separate authorization.</Text>
          <TextInput
            accessibilityLabel="Wallet PIN"
            autoCapitalize="none"
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={setPin}
            placeholder="Six-digit PIN"
            placeholderTextColor={theme.colors.mutedForeground}
            secureTextEntry
            style={styles.input}
            value={pin}
          />
          <ActionButton label="Authenticate and sign locally" onPress={() => void authenticateAndSign('pin')} disabled={pin.length !== 6 || busy} />
          {biometricAvailable ? (
            <ActionButton label="Use biometrics and sign locally" onPress={() => void authenticateAndSign('biometric')} secondary disabled={busy} />
          ) : null}
        </SectionCard>
      ) : null}
      {state === 'approval-signed' || state === 'swap-signed' ? (
        <SectionCard eyebrow="SIGNED — NOT BROADCAST">
          <Text style={styles.body}>The transaction was signed locally. It has not been submitted to the network.</Text>
          <DetailRow label="Transaction hash" value={signedTransaction?.transactionHash ?? ''} />
          <ActionButton label={state === 'approval-signed' ? 'Submit approval transaction' : 'Submit swap transaction'} onPress={() => void broadcastSigned()} />
        </SectionCard>
      ) : null}
      {state.endsWith('broadcasting') || state.endsWith('confirming') ? (
        <View style={styles.statusPanel}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={styles.body}>{state.endsWith('broadcasting') ? 'Broadcasting exact signed bytes…' : 'Waiting for the existing confirmation lifecycle…'}</Text>
        </View>
      ) : null}
      {state === 'completed' || state === 'approval-confirmed' ? (
        <View style={styles.successPanel}>
          <Ionicons name="shield-checkmark-outline" size={22} color={theme.states.success} />
          <Text style={styles.successText}>
            {state === 'completed'
              ? `Confirmed transaction: ${confirmationResult?.transactionHash ?? broadcastResult?.transactionHash ?? ''}`
              : 'Approval confirmed. The swap remains a separate explicit action.'}
          </Text>
        </View>
      ) : null}
      {errorMessage ? <Text accessibilityRole="alert" style={styles.errorText}>{errorMessage}</Text> : null}
      {(state === 'failed' || state === 'unknown' || state === 'completed') ? (
        <ActionButton label="Return to swap" onPress={onBack} secondary />
      ) : null}
      {state !== 'completed' && state !== 'unknown' && state !== 'failed' ? (
        <Pressable accessibilityRole="button" onPress={onBack} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Text style={styles.backText}>Back to review</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function ActionButton({
  label,
  onPress,
  secondary = false,
  disabled = false,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly secondary?: boolean;
  readonly disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        secondary && styles.secondaryButton,
        disabled && styles.disabledButton,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={secondary ? styles.secondaryButtonText : styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: theme.spacing.lg, paddingBottom: 132, gap: theme.spacing.md },
  heading: { marginTop: theme.spacing.lg, gap: theme.spacing.sm },
  eyebrow: { color: theme.colors.accent, fontFamily: theme.typography.eyebrow.fontFamily, fontSize: theme.typography.eyebrow.fontSize, letterSpacing: theme.typography.eyebrow.letterSpacing },
  title: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 30, lineHeight: 37 },
  body: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 14, lineHeight: 21 },
  card: { padding: theme.spacing.md, gap: theme.spacing.sm, borderRadius: theme.radius.lg, backgroundColor: 'rgba(18, 29, 56, 0.86)', borderWidth: 1, borderColor: theme.colors.border, ...theme.shadows.panel },
  warningCard: { borderColor: 'rgba(244, 200, 107, 0.34)', backgroundColor: 'rgba(42, 35, 40, 0.84)' },
  cardEyebrow: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 10, letterSpacing: 1.15 },
  detailRow: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
  detailLabel: { flex: 1, color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12 },
  detailValue: { flex: 1, color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, textAlign: 'right' },
  warningTitle: { color: theme.states.warning, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
  input: { minHeight: 52, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing.md, color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 16, backgroundColor: theme.colors.input, borderWidth: 1, borderColor: theme.colors.border },
  primaryButton: { minHeight: 54, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.md, borderRadius: theme.radius.md, backgroundColor: theme.colors.accent },
  primaryButtonText: { color: theme.colors.primaryForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 15 },
  secondaryButton: { backgroundColor: theme.colors.secondary, borderWidth: 1, borderColor: theme.colors.border },
  secondaryButtonText: { color: theme.colors.accent, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
  disabledButton: { opacity: 0.42 },
  statusPanel: { padding: theme.spacing.md, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(80, 217, 255, 0.08)' },
  successPanel: { padding: theme.spacing.md, flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(87, 224, 151, 0.08)', borderWidth: 1, borderColor: 'rgba(87, 224, 151, 0.3)' },
  successText: { flex: 1, color: theme.states.success, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13, lineHeight: 19 },
  errorText: { color: theme.colors.destructive, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13, lineHeight: 19 },
  backButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
  pressed: { opacity: 0.78 },
  centerState: { flex: 1, minHeight: 520, paddingHorizontal: theme.spacing.lg, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm },
  stateTitle: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 20, textAlign: 'center' },
  stateBody: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 14, lineHeight: 21, textAlign: 'center' },
});