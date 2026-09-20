import { env } from './env';

/**
 * Fiat / NGN↔USDT configuration (autonomous money feature).
 *
 * Currencies, the logical convertible asset, conversion limits and quote lifetime live here so
 * nothing fiat-specific is hard-coded across the app — mirroring the token/network registries.
 *
 * IMPORTANT on units: like the rest of Pexa, amounts are integers in the smallest unit, stored as
 * decimal strings — never floats. NGN uses **kobo** (2 dp); USDT uses 6 dp (same as USDC). The
 * sandbox rate below is a MOCK for development only and must never be shown to users as a live
 * market rate — a real rate always comes from a connected FiatProvider quote.
 */

export const NGN = { code: 'NGN', symbol: '₦', decimals: 2 } as const;
/** USDT is a *logical* asset for the fiat domain. On-chain USDT settlement is provider-gated and
 *  pending a verified Celo USDT contract — do not treat this as an enabled on-chain token yet. */
export const USDT = { symbol: 'USDT', name: 'Tether USD', decimals: 6 } as const;

/** How long a fiat conversion quote stays valid before it must be re-fetched (§14 quote expiry). */
export const QUOTE_TTL_SECONDS = 60;

/**
 * Conversion limits, in smallest units (kobo / USDT-6dp). Deterministic caps the policy engine
 * enforces; per-user overrides can layer on later. Conservative sandbox-era defaults.
 */
export const FIAT_LIMITS = {
  /** Minimum buy/sell order size, NGN in kobo (₦1,000). */
  minOrderNgn: '100000',
  /** Maximum single order, NGN in kobo (₦1,000,000). */
  perOrderNgn: '100000000',
  /** Rolling daily total across fiat orders, NGN in kobo (₦2,000,000). */
  dailyNgn: '200000000',
  /** Rolling monthly total, NGN in kobo (₦10,000,000). */
  monthlyNgn: '1000000000',
} as const;

/**
 * SANDBOX ONLY — a fixed mock reference rate (naira per 1 USDT), used exclusively by the sandbox
 * provider so the quote math is deterministic in tests/dev. Never a live rate. A production
 * provider returns the real rate; this constant is not consulted when a real provider is set.
 */
export const SANDBOX_NGN_PER_USDT = 1612;

/** Whether the fiat feature is switched on (a provider is configured). */
export function isFiatEnabled(): boolean {
  return Boolean(env.FIAT_PROVIDER);
}

/** The configured provider id, or null when fiat is disabled. */
export function fiatProviderId(): 'sandbox' | 'quidax' | null {
  return env.FIAT_PROVIDER ?? null;
}
