/**
 * Design tokens (§94–97).
 *
 * The single source of truth for PrivyPay's visual language: premium AI-native fintech, not a
 * generic crypto dashboard. Every colour is a CSS variable (`--pp-*`, defined in `globals.css`),
 * so the same inline styles render in light and dark: `html[data-theme='dark']` swaps the values.
 * The light values are listed next to each token.
 *
 * Palette is restrained and deliberate — cobalt / navy / off-white / blue-gray, with a single
 * restrained green and red. No AI purple, no neon, no gradients-as-decoration (§94, §137).
 */

export const color = {
  // Primary — cobalt blue
  primary: 'var(--pp-primary)', // #1B45D7
  primaryHover: 'var(--pp-primary-hover)', // #153AB4 (as text on a soft background)
  primaryPress: 'var(--pp-primary-press)', // #153AB4 (a primary button on hover)
  primarySoft: 'var(--pp-primary-soft)', // #EDF1FE
  primarySoftBorder: 'var(--pp-primary-soft-border)', // #DDE3F6
  primaryTint: 'var(--pp-primary-tint)', // #F4F6FE

  // Ink — deep navy (text), and the dark panels that stay dark (chat bubble, balance card)
  ink: 'var(--pp-ink)', // #0E1420
  inkBg: 'var(--pp-ink-bg)', // #0E1420

  // Surfaces — warm off-white
  background: 'var(--pp-background)', // #F6F7F9
  surface: 'var(--pp-surface)', // #FFFFFF
  surfaceMuted: 'var(--pp-surface-muted)', // #FBFBFD
  neutral: 'var(--pp-neutral)', // #F1F2F5 — quiet grey fills (chips, tracks)

  // Cool blue-gray text
  muted: 'var(--pp-muted)', // #5B6472
  mutedStrong: 'var(--pp-muted-strong)', // #5F6878
  faint: 'var(--pp-faint)', // #6C7484
  idle: 'var(--pp-idle)', // #8A93A6 — inactive step / disabled label

  // Borders
  border: 'var(--pp-border)', // #E4E7EC
  borderStrong: 'var(--pp-border-strong)', // #DCE0E7
  borderFaint: 'var(--pp-border-faint)', // #EDEFF3
  line: 'var(--pp-line)', // #E8EAEF
  switchOff: 'var(--pp-switch-off)', // #CBD1DB

  // Restrained status colors
  success: 'var(--pp-success)', // #167A54
  successSoft: 'var(--pp-success-soft)', // #E8F3ED
  successBorder: 'var(--pp-success-border)', // #CDE7DA
  warning: 'var(--pp-warning)', // #8A6A1E
  warningDot: 'var(--pp-warning-dot)', // #D8A93A
  warningTint: 'var(--pp-warning-tint)', // #FEFBF0
  warningBorder: 'var(--pp-warning-border)', // #F0E4C8
  danger: 'var(--pp-danger)', // #C0362A
  dangerText: 'var(--pp-danger-text)', // #A8352A
  dangerSoft: 'var(--pp-danger-soft)', // #F6E9E7
  dangerTint: 'var(--pp-danger-tint)', // #FDF1EF
  dangerBorder: 'var(--pp-danger-border)', // #F0DCD8
} as const;

export const radius = {
  // §96 — cards 12–16, controls 10–12; nothing becomes a pill.
  card: '14px',
  control: '11px',
  pill: '999px',
} as const;

export const shadow = {
  // Restrained, high-offset, low-opacity — depth without heaviness.
  card: '0 30px 60px -38px rgba(14,20,32,.34)',
  soft: '0 24px 48px -34px rgba(14,20,32,.30)',
} as const;

export const font = {
  sans: "var(--font-geist), system-ui, sans-serif",
  mono: "var(--font-geist-mono), ui-monospace, monospace",
} as const;

export const focusRing = '0 0 0 3px rgba(27,69,215,.10)';

export const tokens = { color, radius, shadow, font, focusRing } as const;
export type Tokens = typeof tokens;
