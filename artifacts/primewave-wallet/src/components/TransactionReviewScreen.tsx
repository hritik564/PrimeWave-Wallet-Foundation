import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { theme } from '@/src/theme';
import type { EvmNetwork, NetworkRegistry } from '@/src/core/networks';
import type {
  BroadcastResult,
  ConfirmationResult,
} from '@/src/core/transactions/broadcast';
import {
  activityDirection,
  activityTransactionTypeFor,
} from '@/src/core/activity';
import { formatNativeUnits } from '@/src/core/blockchain/gas-fee';
import type { PortfolioAssetViewModel, PortfolioReadModel } from '@/src/core/portfolio';
import type { Wallet } from '@/src/core/wallet/models';
import { copyPublicAddress, copyPublicText } from './public-address-actions';
import {
  assertSignedTransactionContext,
  assertReviewStillCurrent,
  createReviewSigningAuthorization,
  createPublicReviewConfirmation,
  createTransactionExplorerUrl,
  displayFeePerGas,
  prepareTransactionReview,
  TransactionReviewError,
  type PreparedTransactionReview,
  type PublicReviewConfirmationResult,
  type TransactionActivityDependency,
  type TransactionBroadcastDependency,
  type TransactionConstructionDependency,
  type TransactionSigningDependency,
} from './TransactionReviewScreen.logic';
import type { PublicSendDraft } from './WalletSendScreen.logic';
import {
  createTransactionSigningAuthorization,
  type SignedTransaction,
} from '@/src/core/transactions/signing';

type ReviewState =
  | 'loading'
  | 'ready'
  | 'error'
  | 'awaiting-auth'
  | 'authenticating'
  | 'signing'
  | 'signed'
  | 'broadcasting'
  | 'broadcasted'
  | 'confirming'
  | 'confirmed'
  | 'reverted'
  | 'unknown'
  | 'broadcast-failed'
  | 'preview-confirmed';

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

export function TransactionReviewScreen({
  draft,
  wallet,
  network,
  networkRegistry,
  portfolio,
  createConstructionEngine,
  createSigningDependency,
  createBroadcastDependency,
  activityService,
  onBack,
  onConfirmed,
  onSigned,
}: {
  readonly draft: PublicSendDraft;
  readonly wallet: Wallet;
  readonly network: EvmNetwork;
  readonly networkRegistry: NetworkRegistry;
  readonly portfolio: PortfolioReadModel | null;
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
  readonly activityService?: TransactionActivityDependency | null;
  readonly onBack: () => void;
  readonly onConfirmed: (result: PublicReviewConfirmationResult) => void;
  readonly onSigned?: (result: SignedTransaction) => void;
}) {
  const account = wallet.accounts[0];
  const [review, setReview] = useState<PreparedTransactionReview | null>(null);
  const [engine, setEngine] = useState<TransactionConstructionDependency | null>(null);
  const [signingDependency, setSigningDependency] =
    useState<TransactionSigningDependency | null>(null);
  const [broadcastDependency, setBroadcastDependency] =
    useState<TransactionBroadcastDependency | null>(null);
  const [state, setState] = useState<ReviewState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState<PublicReviewConfirmationResult | null>(null);
  const [signingReview, setSigningReview] = useState<PreparedTransactionReview | null>(null);
  const [signedTransaction, setSignedTransaction] = useState<SignedTransaction | null>(null);
  const [broadcastResult, setBroadcastResult] =
    useState<BroadcastResult | null>(null);
  const [confirmationResult, setConfirmationResult] =
    useState<ConfirmationResult | null>(null);
  const [pin, setPin] = useState('');
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [hashCopyState, setHashCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [activityLocalTransactionId, setActivityLocalTransactionId] =
    useState<string | null>(null);

  const selectedAsset = useMemo(
    () => portfolio?.assets.find(
      (asset) =>
        asset.identity.networkId === draft.networkId &&
        asset.identity.assetType === draft.selectedAssetIdentity.assetType &&
        asset.identity.assetId === draft.selectedAssetIdentity.assetId,
    ),
    [draft, portfolio],
  );

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setReview(null);
    setSigningReview(null);
    setSignedTransaction(null);
    setBroadcastResult(null);
    setConfirmationResult(null);
    setBroadcastDependency(null);
    setHashCopyState('idle');
    setConfirmation(null);
    setErrorMessage(null);
    setActivityLocalTransactionId(null);
    if (!account) {
      setState('error');
      setErrorMessage('The public account is unavailable. Return to Send.');
      return () => { cancelled = true; };
    }
    void Promise.all([
      createConstructionEngine(wallet, draft.networkId),
      createSigningDependency(wallet, draft.networkId),
      createBroadcastDependency(draft.networkId),
    ])
      .then(([nextEngine, nextSigningDependency, nextBroadcastDependency]) => {
        if (cancelled) return;
        setEngine(nextEngine);
        setSigningDependency(nextSigningDependency);
        setBroadcastDependency(nextBroadcastDependency);
        return prepareTransactionReview({
          draft,
          account,
          network,
          registeredNetwork: networkRegistry.getById(draft.networkId),
          activeNetworkId: networkRegistry.getActiveNetwork()?.id ?? null,
          portfolio,
          constructionEngine: nextEngine,
        });
      })
      .then((prepared) => {
        if (cancelled || !prepared) return;
        setReview(prepared);
        setState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState('error');
        setErrorMessage(
          error instanceof TransactionReviewError
            ? error.message
            : 'The transaction review is unavailable. Return to Send.',
        );
      });
    return () => { cancelled = true; };
  }, [
    account,
    createBroadcastDependency,
    createConstructionEngine,
    createSigningDependency,
    draft,
    network,
    networkRegistry,
    portfolio,
    wallet,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (state !== 'awaiting-auth' || !signingDependency) {
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
    if (state !== 'broadcasted' || !broadcastResult || !broadcastDependency) {
      return () => {
        cancelled = true;
      };
    }
    setState('confirming');
    void broadcastDependency.confirm(broadcastResult)
      .then((result) => {
        if (cancelled) return;
        setConfirmationResult(result);
        if (activityService && activityLocalTransactionId) {
          activityService.recordConfirmation(activityLocalTransactionId, result, {
            explorerUrl: createTransactionExplorerUrl(
              network,
              result.transactionHash,
            ),
          });
        }
        setState(
          result.state === 'confirmed'
            ? 'confirmed'
            : result.state === 'reverted'
              ? 'reverted'
              : 'unknown',
        );
        if (result.state === 'unknown') {
          setErrorMessage(
            'Confirmation status unknown. The transaction may still be pending on-chain.',
          );
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setConfirmationResult(null);
        setState('unknown');
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Confirmation status unknown. The transaction may still be pending on-chain.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [
    activityLocalTransactionId,
    activityService,
    broadcastDependency,
    broadcastResult,
    state,
  ]);

  const handleCopy = async () => {
    try {
      await copyPublicAddress(draft.recipient);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  };

  const handleCopyHash = async () => {
    if (!signedTransaction) return;
    try {
      await copyPublicText(signedTransaction.transactionHash);
      setHashCopyState('copied');
    } catch {
      setHashCopyState('error');
    }
  };

  const handleBroadcast = async () => {
    if (
      state !== 'signed' ||
      !signedTransaction ||
      !review ||
      !broadcastDependency
    ) {
      return;
    }
    setState('broadcasting');
    setErrorMessage(null);
    try {
      assertSignedTransactionContext({
        signed: signedTransaction,
        review,
        network,
        activeNetworkId: networkRegistry.getActiveNetwork()?.id ?? null,
      });
      if (activityService && activityLocalTransactionId) {
        activityService.recordBroadcasting(activityLocalTransactionId);
      }
      const result = await broadcastDependency.broadcast(signedTransaction);
      if (activityService && activityLocalTransactionId) {
        activityService.recordBroadcast(activityLocalTransactionId, result, {
          explorerUrl: createTransactionExplorerUrl(
            network,
            result.transactionHash,
          ),
        });
      }
      setBroadcastResult(result);
      if (result.state === 'unknown') {
        setState('unknown');
        setErrorMessage(
          'Broadcast status unknown. The transaction may have reached the network; do not rebroadcast automatically.',
        );
      } else {
        setState('broadcasted');
      }
    } catch (error: unknown) {
      if (activityService && activityLocalTransactionId) {
        activityService.recordFailed(activityLocalTransactionId);
      }
      setState('broadcast-failed');
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'The transaction could not be broadcast. No automatic retry was performed.',
      );
    }
  };

  const handleReconcile = async () => {
    if (
      !broadcastDependency ||
      !broadcastResult ||
      state !== 'unknown'
    ) {
      return;
    }
    setState('confirming');
    setErrorMessage(null);
    try {
      const lookup = await broadcastDependency.lookup(broadcastResult);
      if (lookup.state === 'mined') {
        setErrorMessage(
          'The transaction is mined, but the confirmation result remains unavailable. Review the transaction on the configured explorer.',
        );
      } else if (lookup.state === 'pending') {
        setErrorMessage('The transaction is still pending. No rebroadcast was performed.');
      } else {
        setErrorMessage(
          'The transaction was not found by the selected RPC. Its final status remains unknown; do not rebroadcast automatically.',
        );
      }
      setState('unknown');
    } catch (error: unknown) {
      setState('unknown');
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Transaction reconciliation is unavailable. The final status remains unknown.',
      );
    }
  };

  const handleConfirm = async () => {
    if (!review || !engine || !account || confirming) return;
    setConfirming(true);
    setErrorMessage(null);
    try {
      assertReviewStillCurrent({
        review,
        draft,
        account,
        network,
        activeNetworkId: networkRegistry.getActiveNetwork()?.id ?? null,
        asset: selectedAsset,
      });
      const refreshed = await prepareTransactionReview({
        draft,
        account,
        network,
        registeredNetwork: networkRegistry.getById(draft.networkId),
        activeNetworkId: networkRegistry.getActiveNetwork()?.id ?? null,
        portfolio,
        constructionEngine: engine,
      });
      if (
        refreshed.preview.feeModel !== review.preview.feeModel ||
        refreshed.preview.unsignedTransaction.canonicalRepresentation !==
          review.preview.unsignedTransaction.canonicalRepresentation
      ) {
        throw new TransactionReviewError('STALE_REVIEW');
      }
      const result = createPublicReviewConfirmation(refreshed);
      if (activityService && !activityLocalTransactionId) {
        const activity = activityService.createDraft({
          accountId: refreshed.draft.accountId,
          senderAddress: refreshed.draft.senderPublicAddress,
          networkId: refreshed.draft.networkId,
          chainId: refreshed.preview.chainId,
          transactionType: activityTransactionTypeFor(
            refreshed.asset.assetType,
            refreshed.preview.hasCalldata,
          ),
          direction: activityDirection(
            refreshed.draft.senderPublicAddress,
            refreshed.draft.recipient,
          ),
          assetIdentity: refreshed.asset.identity,
          recipient: refreshed.draft.recipient,
          amountRaw: refreshed.rawAmount,
          amountDecimals: refreshed.asset.decimals,
          amountDisplay: refreshed.draft.amount,
          nativeValue:
            refreshed.asset.assetType === 'native' ? refreshed.rawAmount : 0n,
          tokenContractAddress: refreshed.asset.contractAddress,
          nonce: refreshed.preview.unsignedTransaction.nonce,
          gasLimit: refreshed.preview.unsignedTransaction.gasLimit,
          feeModel: refreshed.preview.feeModel,
          feeAmount: refreshed.preview.estimatedNetworkFee,
        });
        setActivityLocalTransactionId(activity.localTransactionId);
      }
      setReview(refreshed);
      setConfirmation(result);
      onConfirmed(result);
      if (!signingDependency) {
        setState('preview-confirmed');
      } else {
        setSigningReview(refreshed);
        setState('awaiting-auth');
      }
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof TransactionReviewError
          ? error.message
          : 'The transaction review is no longer current. Return to Send.',
      );
    } finally {
      setConfirming(false);
    }
  };

  const authenticationMessage = (result: {
    readonly authenticated: boolean;
    readonly reason: string;
  }): string => {
    if (result.reason === 'cancelled') return 'Authentication was cancelled. Use your PIN or try again.';
    if (result.reason === 'unavailable' || result.reason === 'not-configured') {
      return 'Biometric authentication is unavailable. Use your PIN.';
    }
    if (result.reason === 'locked') return 'Authentication is temporarily unavailable. Try again later.';
    return 'The authentication attempt was not accepted.';
  };

  const handleAuthenticateAndSign = async (
    method: 'pin' | 'biometric',
  ) => {
    if (!signingDependency || !signingReview || !engine || !account || state !== 'awaiting-auth') {
      return;
    }
    setState('authenticating');
    setErrorMessage(null);
    const enteredPin = pin;
    setPin('');
    let signingStarted = false;
    try {
      const authentication = method === 'pin'
        ? await signingDependency.authenticateWithPin(enteredPin)
        : await signingDependency.authenticateWithBiometrics();
      if (!authentication.authenticated) {
        setState('awaiting-auth');
        setErrorMessage(authenticationMessage(authentication));
        return;
      }

      assertReviewStillCurrent({
        review: signingReview,
        draft,
        account,
        network,
        activeNetworkId: networkRegistry.getActiveNetwork()?.id ?? null,
        asset: selectedAsset,
      });
      const latest = await prepareTransactionReview({
        draft,
        account,
        network,
        registeredNetwork: networkRegistry.getById(draft.networkId),
        activeNetworkId: networkRegistry.getActiveNetwork()?.id ?? null,
        portfolio,
        constructionEngine: engine,
      });
      if (
        latest.preview.feeModel !== signingReview.preview.feeModel ||
        latest.preview.unsignedTransaction.canonicalRepresentation !==
          signingReview.preview.unsignedTransaction.canonicalRepresentation
      ) {
        throw new TransactionReviewError('STALE_REVIEW');
      }

      setState('signing');
      signingStarted = true;
      const authorization = createTransactionSigningAuthorization(
        createReviewSigningAuthorization(latest),
      );
      const signed = await signingDependency.sign(
        latest.preview.unsignedTransaction,
        authorization,
      );
      setReview(latest);
      setSignedTransaction(signed);
      if (activityService && activityLocalTransactionId) {
        activityService.recordSigned(activityLocalTransactionId, signed, {
          explorerUrl: createTransactionExplorerUrl(
            network,
            signed.transactionHash,
          ),
        });
      }
      setState('signed');
      onSigned?.(signed);
    } catch (error: unknown) {
      if (signingStarted && activityService && activityLocalTransactionId) {
        activityService.recordFailed(activityLocalTransactionId);
      }
      setState(error instanceof TransactionReviewError ? 'error' : 'awaiting-auth');
      setErrorMessage(
        error instanceof TransactionReviewError || error instanceof Error
          ? error.message
          : 'The transaction could not be signed. Return to Send.',
      );
    }
  };

  const signedLifecycleStates: readonly ReviewState[] = [
    'signed',
    'broadcasting',
    'broadcasted',
    'confirming',
    'confirmed',
    'reverted',
    'unknown',
    'broadcast-failed',
  ];
  const explorerUrl = signedTransaction
    ? createTransactionExplorerUrl(network, signedTransaction.transactionHash)
    : null;

  if (
    signedLifecycleStates.includes(state) &&
    signedTransaction &&
    review &&
    confirmation
  ) {
    const readyToBroadcast = state === 'signed';
    const isBroadcasting = state === 'broadcasting';
    const isConfirming = state === 'confirming';
    const isTerminal =
      state === 'confirmed' || state === 'reverted' || state === 'unknown';
    const statusEyebrow =
      state === 'signed'
        ? 'SIGNED — NOT BROADCAST'
        : state === 'broadcasting'
          ? 'BROADCASTING'
          : state === 'broadcasted'
            ? 'BROADCASTED'
            : state === 'confirming'
              ? 'CONFIRMING'
              : state === 'confirmed'
                ? 'CONFIRMED'
                : state === 'reverted'
                  ? 'REVERTED'
                  : state === 'unknown'
                    ? 'UNKNOWN'
                    : 'BROADCAST FAILED';
    const title =
      state === 'signed'
        ? 'Transaction Signed'
        : state === 'broadcasting'
          ? 'Broadcasting Transaction'
          : state === 'broadcasted'
            ? 'Transaction Broadcasted'
            : state === 'confirming'
              ? 'Waiting for Confirmation'
              : state === 'confirmed'
                ? 'Transaction Confirmed'
                : state === 'reverted'
                  ? 'Transaction Reverted'
                  : state === 'unknown'
                    ? 'Confirmation Unknown'
                    : 'Broadcast Failed';
    const body =
      state === 'signed'
        ? 'The transaction was signed locally. It has not been submitted to the network.'
        : state === 'broadcasting'
          ? 'Submitting the exact signed transaction to the selected network.'
          : state === 'broadcasted'
            ? 'The selected network accepted the signed transaction.'
            : state === 'confirming'
              ? 'Waiting for the network to include the transaction in a block.'
              : state === 'confirmed'
                ? 'The network included this transaction successfully.'
                : state === 'reverted'
                  ? 'The transaction was included but the network reported a revert.'
                  : state === 'unknown'
                    ? 'The final on-chain status is not known. Do not rebroadcast automatically.'
                    : 'The signed transaction was not submitted. No automatic retry was performed.';

    return (
      <ScrollView
        accessibilityLabel={`Transaction ${state}`}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>{statusEyebrow}</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
        </View>
        <SectionCard eyebrow={readyToBroadcast ? 'FINAL BROADCAST CHECKPOINT' : 'TRANSACTION STATUS'}>
          <DetailRow label="Network" value={network.displayName} />
          <DetailRow label="Asset" value={review?.asset.symbol ?? 'Asset'} />
          <DetailRow label="Recipient" value={shortAddress(confirmation.recipient)} />
          <DetailRow label="Amount" value={`${confirmation.amount} ${review?.asset.symbol ?? ''}`} />
          <DetailRow label="Transaction hash" value={signedTransaction.transactionHash} />
          {broadcastResult ? (
            <DetailRow label="Broadcast status" value={broadcastResult.state === 'broadcasted' ? 'Accepted by network' : 'Unknown'} />
          ) : null}
          {confirmationResult?.receipt ? (
            <DetailRow
              label="Block"
              value={`${confirmationResult.receipt.blockNumber.toString()} · ${confirmationResult.receipt.status}`}
            />
          ) : null}
          {readyToBroadcast ? (
            <Text style={styles.cardBody}>
              Broadcasting submits this already-signed transaction to the selected network. Blockchain transactions may be irreversible.
            </Text>
          ) : null}
        </SectionCard>
        <Pressable
          accessibilityLabel="Copy transaction hash"
          accessibilityRole="button"
          onPress={() => void handleCopyHash()}
          style={({ pressed }) => [styles.hashCopyButton, pressed && styles.pressed]}
        >
          <Ionicons name="copy-outline" size={16} color={theme.colors.accent} />
          <Text style={styles.copyButtonText}>
            {hashCopyState === 'copied'
              ? 'Hash copied'
              : hashCopyState === 'error'
                ? 'Copy unavailable'
                : 'Copy transaction hash'}
          </Text>
        </Pressable>
        <View accessibilityRole="alert" style={styles.safeNotice}>
          <Ionicons
            name={
              state === 'reverted' || state === 'unknown' || state === 'broadcast-failed'
                ? 'warning-outline'
                : 'shield-checkmark-outline'
            }
            size={20}
            color={
              state === 'reverted' || state === 'unknown' || state === 'broadcast-failed'
                ? theme.states.warning
                : theme.states.success
            }
          />
          <Text style={styles.safeNoticeText}>
            {readyToBroadcast
              ? 'Signed locally. Not yet broadcast.'
              : state === 'confirmed'
                ? 'Confirmed on-chain by the selected network.'
                : state === 'reverted'
                  ? 'Broadcast completed, but execution reverted on-chain.'
                  : state === 'unknown'
                    ? 'The transaction may still be pending. No automatic rebroadcast was performed.'
                    : state === 'broadcast-failed'
                      ? 'No automatic retry was performed.'
                      : 'The signed transaction is being processed by the selected network.'}
          </Text>
        </View>
        {isBroadcasting || isConfirming ? (
          <View style={styles.progressCard}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={styles.progressText}>
              {isBroadcasting ? 'Broadcasting exact signed bytes…' : 'Monitoring confirmation…'}
            </Text>
          </View>
        ) : null}
        {errorMessage && (state === 'unknown' || state === 'broadcast-failed') ? (
          <View accessibilityRole="alert" style={styles.errorCard}>
            <Ionicons name="warning-outline" size={22} color={theme.colors.destructive} />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}
        {readyToBroadcast ? (
          <Pressable
            accessibilityLabel="Broadcast Transaction"
            accessibilityRole="button"
            disabled={!broadcastDependency}
            onPress={() => void handleBroadcast()}
            style={({ pressed }) => [
              styles.primaryButton,
              !broadcastDependency && styles.disabledButton,
              pressed && broadcastDependency && styles.pressed,
            ]}
          >
            <Ionicons name="cloud-upload-outline" size={18} color={theme.colors.primaryForeground} />
            <Text style={styles.primaryButtonText}>Broadcast Transaction</Text>
          </Pressable>
        ) : null}
        {state === 'unknown' ? (
          <Pressable
            accessibilityLabel="Reconcile transaction status"
            accessibilityRole="button"
            disabled={!broadcastDependency || !broadcastResult}
            onPress={() => void handleReconcile()}
            style={({ pressed }) => [
              styles.secondaryButton,
              (!broadcastDependency || !broadcastResult) && styles.disabledButton,
              pressed && broadcastDependency && broadcastResult && styles.pressed,
            ]}
          >
            <Ionicons name="refresh-outline" size={18} color={theme.colors.accent} />
            <Text style={styles.secondaryButtonText}>Reconcile Status</Text>
          </Pressable>
        ) : null}
        {explorerUrl && !readyToBroadcast ? (
          <Pressable
            accessibilityLabel="View transaction on explorer"
            accessibilityRole="button"
            onPress={() => void Linking.openURL(explorerUrl)}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Ionicons name="open-outline" size={18} color={theme.colors.accent} />
            <Text style={styles.secondaryButtonText}>View on Explorer</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityLabel="Return to Send"
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
          <Ionicons name="arrow-back-outline" size={18} color={theme.colors.accent} />
          <Text style={styles.secondaryButtonText}>Return to Send</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (state === 'preview-confirmed' && confirmation) {
    return (
      <ScrollView
        accessibilityLabel="Transaction confirmed for signing in Preview Test Mode"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>PREVIEW TEST MODE</Text>
          <Text style={styles.title}>Confirmed for signing</Text>
          <Text style={styles.body}>
            The public review matched the current transaction context. Native authentication and signing are unavailable in browser Preview Test Mode.
          </Text>
        </View>
        <SectionCard eyebrow="NO SIMULATED SIGNATURE">
          <DetailRow label="Network" value={network.displayName} />
          <DetailRow label="Recipient" value={shortAddress(confirmation.recipient)} />
          <DetailRow label="Amount" value={`${confirmation.amount} ${review?.asset.symbol ?? ''}`} />
          <Text style={styles.helperText}>
            Preview Test Mode does not create a fake transaction hash or present simulated signing as a real blockchain result.
          </Text>
        </SectionCard>
        <Pressable
          accessibilityLabel="Return to Send"
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
          <Ionicons name="arrow-back-outline" size={18} color={theme.colors.accent} />
          <Text style={styles.secondaryButtonText}>Return to Send</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      accessibilityLabel="Transaction review screen"
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>SAFETY CHECKPOINT</Text>
        <Text style={styles.title}>Review transaction</Text>
        <Text style={styles.body}>
          Confirm the public details and read-only fee estimate before the next secure signing phase.
        </Text>
      </View>

      {state === 'loading' ? (
        <SectionCard eyebrow="PREPARING REVIEW">
          <Text style={styles.cardBody}>Checking the selected network, asset, balance, and fee data…</Text>
        </SectionCard>
      ) : state === 'error' ? (
        <View accessibilityRole="alert" style={styles.errorCard}>
          <Ionicons name="warning-outline" size={22} color={theme.states.warning} />
          <View style={styles.errorCopy}>
            <Text style={styles.errorTitle}>Review unavailable</Text>
            <Text style={styles.errorText}>{errorMessage ?? 'Return to Send and try again.'}</Text>
          </View>
        </View>
      ) : review ? (
        <>
          <SectionCard eyebrow="NETWORK">
            <DetailRow label="Network" value={network.displayName} />
            <DetailRow label="Chain ID" value={String(network.chainId)} />
            <DetailRow label="Native fee currency" value={`${network.nativeCurrency.name} (${network.nativeCurrency.symbol})`} />
            <Text style={styles.configuredText}>Configured and bound to the selected network</Text>
          </SectionCard>

          <SectionCard eyebrow="FROM">
            <DetailRow label={`Account ${account?.index === undefined ? '' : account.index + 1}`} value={shortAddress(draft.senderPublicAddress)} />
            <Text selectable style={styles.fullAddress}>{draft.senderPublicAddress}</Text>
          </SectionCard>

          <SectionCard eyebrow="TO">
            <View style={styles.recipientRow}>
              <View style={styles.recipientCopy}>
                <Text style={styles.recipientAddress}>{shortAddress(draft.recipient)}</Text>
                <Text selectable style={styles.fullAddress}>{draft.recipient}</Text>
              </View>
              <Pressable
                accessibilityLabel="Copy recipient address"
                accessibilityRole="button"
                onPress={() => void handleCopy()}
                style={styles.copyButton}
              >
                <Ionicons name="copy-outline" size={16} color={theme.colors.accent} />
                <Text style={styles.copyButtonText}>{copyState === 'copied' ? 'Copied' : 'Copy'}</Text>
              </Pressable>
            </View>
            <Text style={styles.helperText}>Syntax is valid. Destination safety has not been independently verified.</Text>
            {copyState === 'error' ? <Text style={styles.errorText}>Could not copy the address.</Text> : null}
          </SectionCard>

          <SectionCard eyebrow="ASSET / AMOUNT">
            <DetailRow label="Asset" value={`${review.asset.name ?? 'Asset'} (${review.asset.symbol ?? '—'})`} />
            <DetailRow label="Exact amount" value={`${draft.amount} ${review.asset.symbol ?? ''}`} />
            {review.asset.assetType === 'fungible_token' && review.asset.contractAddress ? (
              <DetailRow label="Token contract" value={shortAddress(review.asset.contractAddress)} />
            ) : null}
          </SectionCard>

          <SectionCard eyebrow="NETWORK FEE">
            <DetailRow label="Fee model" value={review.preview.feeModel === 'eip1559' ? 'EIP-1559' : 'Legacy'} />
            <DetailRow label="Gas limit" value={review.preview.gasLimit.toString()} />
            <DetailRow label="Fee per gas" value={`${displayFeePerGas(review.preview)} ${review.preview.symbol}`} />
            <DetailRow label="Estimated network fee" value={`${review.preview.estimatedNetworkFeeDisplay} ${review.preview.symbol}`} />
            {review.preview.feeModel === 'eip1559' ? (
              <DetailRow label="Maximum fee per gas" value={`${formatNativeUnits(review.preview.maxFeePerGas, review.preview.decimals)} ${review.preview.symbol}`} />
            ) : null}
          </SectionCard>

          <SectionCard eyebrow="TOTAL">
            {review.asset.assetType === 'native' ? (
              <>
                <DetailRow label="Transfer amount" value={`${draft.amount} ${review.asset.symbol ?? ''}`} />
                <DetailRow label="Maximum total required" value={`${review.preview.totalMaximumNativeAmountDisplay} ${review.preview.symbol}`} />
              </>
            ) : (
              <>
                <DetailRow label="Token amount" value={`${draft.amount} ${review.asset.symbol ?? ''}`} />
                <DetailRow label="Network fee" value={`${review.preview.estimatedNetworkFeeDisplay} ${review.preview.symbol}`} />
              </>
            )}
          </SectionCard>

          {review.warnings.length > 0 ? (
            <SectionCard eyebrow="WARNINGS" warning>
              {review.warnings.map((warning) => (
                <View accessibilityRole="alert" key={warning} style={styles.warningRow}>
                  <Ionicons name="alert-circle-outline" size={17} color={theme.states.warning} />
                  <Text style={styles.warningText}>{warning}</Text>
                </View>
              ))}
            </SectionCard>
          ) : null}

          {errorMessage ? (
            <View accessibilityRole="alert" style={styles.errorCard}>
              <Ionicons name="warning-outline" size={22} color={theme.colors.destructive} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          {state === 'ready' ? (
            <Pressable
              accessibilityLabel="Confirm Transaction"
              accessibilityRole="button"
              disabled={confirming}
              onPress={() => void handleConfirm()}
              style={({ pressed }) => [styles.primaryButton, confirming && styles.disabledButton, pressed && !confirming && styles.pressed]}
            >
              <Text style={styles.primaryButtonText}>{confirming ? 'Checking review…' : 'Confirm Transaction'}</Text>
              <Ionicons name="arrow-forward-outline" size={18} color={theme.colors.primaryForeground} />
            </Pressable>
          ) : null}

          {state === 'awaiting-auth' ? (
            <SectionCard eyebrow="AUTHORIZE TRANSACTION" warning>
              <Text style={styles.cardBody}>
                Review complete. Authenticate your wallet to authorize this exact transaction. Check the recipient and network carefully; blockchain transactions may be irreversible.
              </Text>
              <TextInput
                accessibilityLabel="Wallet PIN"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="number-pad"
                maxLength={6}
                onChangeText={setPin}
                placeholder="Six-digit PIN"
                placeholderTextColor={theme.colors.mutedForeground}
                secureTextEntry
                style={styles.pinInput}
                value={pin}
              />
              <Pressable
                accessibilityLabel="Authorize with PIN"
                accessibilityRole="button"
                disabled={pin.length !== 6}
                onPress={() => void handleAuthenticateAndSign('pin')}
                style={({ pressed }) => [styles.primaryButton, pin.length !== 6 && styles.disabledButton, pressed && pin.length === 6 && styles.pressed]}
              >
                <Text style={styles.primaryButtonText}>Authorize with PIN</Text>
                <Ionicons name="key-outline" size={18} color={theme.colors.primaryForeground} />
              </Pressable>
              {biometricAvailable ? (
                <Pressable
                  accessibilityLabel="Authorize with biometrics"
                  accessibilityRole="button"
                  onPress={() => void handleAuthenticateAndSign('biometric')}
                  style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                >
                  <Ionicons name="finger-print-outline" size={18} color={theme.colors.accent} />
                  <Text style={styles.secondaryButtonText}>Use biometrics</Text>
                </Pressable>
              ) : null}
            </SectionCard>
          ) : null}

          {state === 'authenticating' ? (
            <View accessibilityRole="alert" style={styles.progressCard}>
              <ActivityIndicator color={theme.colors.accent} />
              <Text style={styles.progressText}>Authenticating wallet…</Text>
            </View>
          ) : null}

          {state === 'signing' ? (
            <View accessibilityRole="alert" style={styles.progressCard}>
              <ActivityIndicator color={theme.colors.accent} />
              <Text style={styles.progressText}>Signing transaction locally…</Text>
            </View>
          ) : null}
        </>
      ) : null}

      <Pressable
        accessibilityLabel="Back to Send"
        accessibilityRole="button"
        onPress={onBack}
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
      >
        <Ionicons name="arrow-back-outline" size={18} color={theme.colors.accent} />
        <Text style={styles.secondaryButtonText}>Back to Send</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: theme.spacing.lg, paddingBottom: 132, gap: theme.spacing.md },
  heading: { marginTop: theme.spacing.lg, gap: theme.spacing.sm },
  eyebrow: { color: theme.colors.accent, fontFamily: theme.typography.eyebrow.fontFamily, fontSize: theme.typography.eyebrow.fontSize, letterSpacing: theme.typography.eyebrow.letterSpacing },
  title: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 32, lineHeight: 39 },
  body: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 14, lineHeight: 21 },
  card: { padding: theme.spacing.md, gap: theme.spacing.sm, borderRadius: theme.radius.lg, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  warningCard: { borderColor: 'rgba(244, 200, 107, 0.42)', backgroundColor: 'rgba(244, 200, 107, 0.08)' },
  cardEyebrow: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 10, letterSpacing: 1.15 },
  cardBody: { color: theme.colors.mutedForeground, fontFamily: theme.typography.body.fontFamily, fontSize: 13, lineHeight: 20 },
  detailRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: 'rgba(126, 145, 191, 0.14)' },
  detailLabel: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12 },
  detailValue: { flex: 1, color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13, textAlign: 'right' },
  configuredText: { color: theme.states.success, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11 },
  fullAddress: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11, lineHeight: 17 },
  recipientRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  recipientCopy: { flex: 1, gap: 4 },
  recipientAddress: { color: theme.colors.foreground, fontFamily: theme.typography.title.fontFamily, fontSize: 19 },
  helperText: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11, lineHeight: 17 },
  copyButton: { minHeight: 40, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: theme.radius.sm, backgroundColor: 'rgba(80, 217, 255, 0.1)' },
  hashCopyButton: { minHeight: 40, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: theme.radius.sm, backgroundColor: 'rgba(80, 217, 255, 0.1)' },
  copyButtonText: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 11 },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  warningText: { flex: 1, color: theme.states.warning, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18 },
  errorCard: { padding: theme.spacing.md, flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(255, 103, 133, 0.1)', borderWidth: 1, borderColor: 'rgba(255, 103, 133, 0.35)' },
  errorCopy: { flex: 1, gap: 4 },
  errorTitle: { color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 14 },
  errorText: { color: theme.colors.destructive, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18 },
  safeNotice: { padding: theme.spacing.md, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(101, 230, 166, 0.1)', borderWidth: 1, borderColor: 'rgba(101, 230, 166, 0.35)' },
  safeNoticeText: { flex: 1, color: theme.states.success, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 12, lineHeight: 18 },
  pinInput: { minHeight: 50, paddingHorizontal: theme.spacing.md, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.background, color: theme.colors.foreground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 18, letterSpacing: 6, textAlign: 'center' },
  progressCard: { minHeight: 58, padding: theme.spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: 'rgba(80, 217, 255, 0.08)', borderWidth: 1, borderColor: 'rgba(80, 217, 255, 0.3)' },
  progressText: { color: theme.colors.accent, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 13 },
  deferredButton: { minHeight: 58, paddingHorizontal: theme.spacing.lg, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: 'rgba(18, 29, 56, 0.65)' },
  deferredButtonText: { color: theme.colors.mutedForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 13 },
  deferredButtonHint: { color: theme.colors.mutedForeground, fontFamily: theme.typography.bodyMedium.fontFamily, fontSize: 11 },
  primaryButton: { minHeight: 54, marginTop: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: theme.colors.accent, ...theme.shadows.glow },
  primaryButtonText: { color: theme.colors.primaryForeground, fontFamily: theme.typography.label.fontFamily, fontSize: 13, letterSpacing: 0.4 },
  disabledButton: { opacity: 0.45 },
  secondaryButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: 'rgba(18, 29, 56, 0.65)' },
  secondaryButtonText: { color: theme.colors.accent, fontFamily: theme.typography.label.fontFamily, fontSize: 12 },
  pressed: { opacity: theme.states.pressedOpacity },
});