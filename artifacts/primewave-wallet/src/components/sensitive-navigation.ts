export type ViewName =
  | 'loading'
  | 'unavailable'
  | 'welcome'
  | 'warning'
  | 'phrase'
  | 'phrase-confirm'
  | 'import'
  | 'import-confirm'
  | 'pin'
  | 'biometric'
  | 'locked'
  | 'wallet'
  | 'dapp-approval'
  | 'dapp-signing'
  | 'dapp-transaction'
  | 'security'
  | 'recovery';

export class SensitiveNavigation {
  view: ViewName = 'loading';
  revision = 0;

  invalidate(): void {
    this.revision++;
  }

  move(next: ViewName, cleanup: { clearSecurityPins(): void; clearReveal(): void }): void {
    if (this.view !== next) this.invalidate();
    if (this.view === 'security' || next === 'locked') cleanup.clearSecurityPins();
    if (this.view === 'recovery' || next === 'locked') cleanup.clearReveal();
    this.view = next;
  }
}
