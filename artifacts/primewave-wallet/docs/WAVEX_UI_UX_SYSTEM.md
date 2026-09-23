# WaveX UI/UX System — UI-0

UI-0 establishes the reusable visual language for WaveX. It does not redesign
production screens or change wallet, security, blockchain, portfolio,
transaction, swap, DApp, or backend behavior.

## Product direction

WaveX follows **simple on the surface, sophisticated under the hood**.
Primary screens should answer the user's immediate questions:

- What do I own?
- Which network and account are active?
- What can I do next?
- Is an action available, pending, or unavailable?

Technical data such as chain IDs, raw calldata, hashes, provider metadata, gas
internals, and contract addresses belongs behind progressive disclosure on
detail surfaces.

The usability benchmark is MetaMask. The visual identity is WaveX: dark,
restrained, cyan-led, and financially clear. Neon and gradients are reserved
for primary actions, selected states, and important emphasis.

## Source of truth

The design system entry point is:

```ts
import {
  colors,
  spacing,
  radius,
  typography,
  motion,
  icons,
  WaveXButton,
  WaveXCard,
} from '@/src/design-system';
```

Token files live under `src/design-system/tokens`, with typography, motion,
icons, and reusable primitives in their own folders. `src/theme` remains a
compatibility export for existing production screens and now reads from the
same token source.

## Color

The palette uses near-black midnight navy for the application background,
elevated navy surfaces, cool borders, white primary text, blue-gray secondary
text, WaveX cyan for primary emphasis, electric violet for secondary emphasis,
and restrained semantic colors.

| Role | Token | Use |
| --- | --- | --- |
| App background | `colors.background` | Root surfaces and screen canvas |
| Surface | `colors.surface` | Cards, rows, and panels |
| Elevated surface | `colors.surfaceElevated` | Sheets, dialogs, selected controls |
| Primary action | `colors.accent` | Send, receive, review, confirm, selected tab |
| Secondary action | `colors.primary` | Supporting emphasis and gradients |
| Primary text | `colors.textPrimary` | Balances, titles, important values |
| Secondary text | `colors.textSecondary` | Supporting labels |
| Muted text | `colors.textMuted` | Captions and unavailable details |
| Active border | `colors.borderActive` | Focus and selected controls |
| Success | `colors.success` | Confirmed and available states |
| Warning | `colors.warning` | Stale, unconfigured, or caution states |
| Error | `colors.error` | Failed and destructive states |

Do not use a token logo as evidence that an asset is verified. Verification
status is separate from iconography.

## Typography

Inter is the functional typeface. `typography.balance` is reserved for
portfolio numbers and transaction amounts. It uses tabular numerals where the
platform supports them. The hierarchy is:

1. `display`
2. `balance`
3. `pageTitle`
4. `sectionHeading`
5. `cardTitle`
6. `body`
7. `bodySecondary`
8. `label`
9. `caption`
10. `micro`

Legacy aliases (`eyebrow`, `title`, and `bodyMedium`) remain available so
existing screens can migrate incrementally without visual or behavior changes.

## Spacing, radius, and elevation

Use `spacing.xs` through `spacing.xxl` for screen margins, card padding,
section gaps, row gaps, and controls. Use `radius.sm` for small controls,
`radius.md` for inputs and buttons, `radius.lg` for cards, `radius.sheet` for
bottom sheets, and `radius.pill` for chips and status indicators.

`shadows.panel` is for elevated surfaces. `shadows.glow` is reserved for
important WaveX emphasis and should not appear on every card. Prefer borders
over glow for ordinary grouping.

## Reusable primitives

The current UI-0 primitive set includes:

- Actions: `WaveXButton`, `WaveXIconButton`
- Containers: `WaveXCard`, `WaveXDivider`
- Forms: `WaveXInput`, `WaveXSearchInput`, `WaveXSegmentedControl`
- Tags: `WaveXChip`, `WaveXBadge`, `WaveXStatusIndicator`
- Identity: `WaveXNetworkBadge`, `WaveXAccountBadge`, `WaveXAssetIcon`
- Data rows: `WaveXAssetRow`, `WaveXTransactionRow`
- Layout: `WaveXSectionHeader`, `WaveXBottomNavigation`
- Overlays: `WaveXBottomSheet`, `WaveXModal`, `WaveXToast`
- States: `WaveXSkeleton`, `WaveXLoadingState`, `WaveXEmptyState`,
  `WaveXErrorState`

Asset rows are asset-first: icon, name, symbol/network, then amount and
status. Transaction rows are action-first with the asset and network context
visible before the amount. Amounts must remain precise; fiat values must never
be fabricated.

## Buttons and inputs

Use the primary button for deliberate forward actions such as create, review,
confirm, send, and swap. Use secondary buttons for supporting actions, outline
buttons for lower-emphasis alternatives, and destructive buttons only when the
action is irreversible or removes local state.

Loading buttons expose a busy accessibility state and remain readable. Disabled
buttons are visibly disabled but not removed from the layout. Inputs have a
minimum 48px height, clear focus/error treatment, readable labels, and
accessible names.

## Navigation and sheets

The primary navigation is Home, Assets, Swap, Activity, and Settings. Selected
tabs use cyan with an icon and label; unselected tabs use muted blue-gray.
Navigation should not be decorated with persistent glow or animation.

Use bottom sheets for network selection, account selection, token selection,
filters, and contextual actions. Sheets must respect safe areas, provide a
clear close affordance, preserve confirmation information, and expose modal
semantics to screen readers.

## Status, loading, and errors

Use explicit states: available, success, pending, warning, error, unavailable,
disabled, selected, active, and processing. `AVAILABLE + ZERO BALANCE` is valid
and must not be shown as unavailable. Loading should use skeleton structure
where possible. Errors should state what happened and what the user can do;
technical diagnostics belong in advanced surfaces.

## Motion

Motion communicates press, selection, navigation, sheet presentation, refresh,
loading, success, and completion. Use `motion.duration.fast`,
`motion.duration.standard`, and `motion.duration.slow`. Avoid constant
movement, particles, excessive glow, and animation that competes with
financial information.

## Accessibility and responsive behavior

Every interactive primitive provides an accessible role and label, stateful
controls expose selected/disabled/busy state, and touch targets are at least
48px where practical. Color is never the only state signal. Support readable
text scaling, screen readers, focus treatment, reduced motion, and keyboard
navigation where the platform provides it.

The system is designed for small iPhones, large iPhones, Android phones, and
browser Preview. Use safe-area insets and flex layouts instead of screen-size
specific coordinates. Avoid fixed widths for content that can wrap.

## Do / don't

### Do

- Show the active account and network near the primary wallet context.
- Keep balances and transaction amounts visually scannable.
- Use progressive disclosure for advanced blockchain details.
- Preserve unavailable, stale, disabled, and zero-balance distinctions.
- Reuse the existing asset identity and verification boundaries.

### Don't

- Put chain IDs, RPC details, raw calldata, or hashes on primary surfaces.
- Infer token verification from a logo.
- Fabricate fiat values or transaction interpretations.
- Recreate wallet, signing, authentication, network, or DApp logic in a UI
  primitive.
- Start UI-1 screen redesign work as part of UI-0.