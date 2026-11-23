import type { ERC20Token } from '@/src/core/assets';
import type { EvmNetwork } from '@/src/core/networks';

export interface AddTokenPreviewBinding {
  readonly token: ERC20Token;
  readonly input: string;
  readonly contractAddress: string;
  readonly networkId: string;
  readonly chainId: number;
  readonly selectionRevision: number;
  readonly generation: number;
}

export interface AddTokenValidationSnapshot {
  readonly input: string;
  readonly preview: AddTokenPreviewBinding | null;
  readonly busy: boolean;
  readonly message: string | null;
}

export function normalizeTokenContractInput(input: string): string | null {
  const trimmed = input.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** Operation controller shared by the Add Token modal and interaction tests. */
export class AddTokenValidationController {
  private generation = 0;
  private disposed = false;
  private snapshot: AddTokenValidationSnapshot = {
    input: '', preview: null, busy: false, message: null,
  };
  private listeners = new Set<(snapshot: AddTokenValidationSnapshot) => void>();
  private revisionIsCurrent: (network: EvmNetwork, revision: number) => boolean = () => true;

  constructor(revisionIsCurrent: (network: EvmNetwork, revision: number) => boolean = () => true) {
    this.revisionIsCurrent = revisionIsCurrent;
  }

  getSnapshot = (): AddTokenValidationSnapshot => this.snapshot;

  subscribe = (listener: (snapshot: AddTokenValidationSnapshot) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(snapshot: AddTokenValidationSnapshot): void {
    if (this.disposed) return;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }

  setInput(input: string): void {
    if (input === this.snapshot.input) return;
    this.generation++;
    this.update({ input, preview: null, busy: false, message: null });
  }

  invalidate(message: string | null = null): void {
    this.generation++;
    this.update({ ...this.snapshot, preview: null, busy: false, message });
  }

  dispose(): void {
    this.generation++;
    this.disposed = true;
    this.listeners.clear();
  }

  isPreviewCurrent(network: EvmNetwork, selectionRevision: number): boolean {
    const preview = this.snapshot.preview;
    return !!preview && !this.disposed && !this.snapshot.busy &&
      preview.input === this.snapshot.input &&
      normalizeTokenContractInput(this.snapshot.input) === preview.contractAddress &&
      preview.networkId === network.id && preview.chainId === network.chainId &&
      preview.selectionRevision === selectionRevision &&
      preview.generation === this.generation;
  }

  async validate(
    network: EvmNetwork,
    selectionRevision: number,
    readMetadata: (network: EvmNetwork, contractAddress: string) => Promise<ERC20Token>,
  ): Promise<void> {
    const input = this.snapshot.input;
    const contractAddress = normalizeTokenContractInput(input);
    const generation = ++this.generation;
    if (!contractAddress) {
      this.update({ input, preview: null, busy: false, message: 'Enter a valid 20-byte contract address.' });
      return;
    }
    if (network.configurationStatus !== 'configured' || network.chainId === null) {
      this.update({ input, preview: null, busy: false, message: 'This network is not configured for token reads.' });
      return;
    }
    this.update({ input, preview: null, busy: true, message: null });
    try {
      const token = await readMetadata(network, contractAddress);
      if (!this.isOperationCurrent(generation, input, network, selectionRevision)) {
        this.finishStaleOperation(generation, input, 'The active network changed. Check this contract on the selected network.');
        return;
      }
      if (token.chainId !== network.chainId) throw new Error('chain mismatch');
      if (token.metadataStatus === 'invalid' || token.decimals === null) throw new Error('invalid metadata');
      this.update({
        input,
        preview: { token, input, contractAddress, networkId: network.id, chainId: network.chainId, selectionRevision, generation },
        busy: false,
        message: null,
      });
    } catch {
      if (!this.isOperationCurrent(generation, input, network, selectionRevision)) {
        this.finishStaleOperation(generation, input, 'The active network changed. Check this contract on the selected network.');
        return;
      }
      this.update({ input, preview: null, busy: false, message: 'Could not validate this contract on the selected network. Check the address and network.' });
    }
  }

  private finishStaleOperation(generation: number, input: string, message: string): void {
    if (!this.disposed && this.generation === generation && this.snapshot.input === input) {
      this.update({ ...this.snapshot, preview: null, busy: false, message });
    }
  }

  async register(
    network: EvmNetwork,
    selectionRevision: number,
    register: (request: { networkId: string; contractAddress: string }) => Promise<unknown>,
    onRegistered: () => void,
  ): Promise<void> {
    const preview = this.snapshot.preview;
    if (!preview || !this.isPreviewCurrent(network, selectionRevision)) return;
    const generation = ++this.generation;
    this.update({ ...this.snapshot, busy: true, message: null });
    try {
      await register({ networkId: preview.networkId, contractAddress: preview.contractAddress });
      if (!this.isRegistrationCurrent(generation, preview, network, selectionRevision) ||
          preview.generation !== generation - 1 || preview.networkId !== network.id ||
          preview.chainId !== network.chainId || preview.selectionRevision !== selectionRevision ||
          normalizeTokenContractInput(preview.input) !== preview.contractAddress) return;
      this.update({ ...this.snapshot, busy: false, preview: null });
      onRegistered();
    } catch {
      if (!this.isRegistrationCurrent(generation, preview, network, selectionRevision)) return;
      this.update({ ...this.snapshot, busy: false, preview: null, message: 'This token could not be added. It may already be registered or its contract is unavailable.' });
    }
  }

  private isRegistrationCurrent(
    generation: number,
    preview: AddTokenPreviewBinding,
    network: EvmNetwork,
    selectionRevision: number,
  ): boolean {
    return !this.disposed && this.generation === generation &&
      this.snapshot.input === preview.input && this.snapshot.preview === preview &&
      this.snapshot.busy && network.id === preview.networkId &&
      network.chainId === preview.chainId && selectionRevision === preview.selectionRevision &&
      this.boundNetworkStillSelected(network, selectionRevision);
  }

  private isOperationCurrent(
    generation: number,
    input: string,
    network: EvmNetwork,
    selectionRevision: number,
  ): boolean {
    return !this.disposed && this.generation === generation &&
      this.snapshot.input === input && normalizeTokenContractInput(input) !== null &&
      network.chainId !== null && network.configurationStatus === 'configured' &&
      this.snapshot.preview === null &&
      this.boundNetworkStillSelected(network, selectionRevision);
  }

  private boundNetworkStillSelected(network: EvmNetwork, revision: number): boolean {
    return this.revisionIsCurrent(network, revision);
  }
}
