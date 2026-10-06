/**
 * Spending policy for agent purchases — the "seatbelt". Pure and deterministic: given the price, the
 * user's settings and the facts around them, it answers one question — may Pexa pay on its own, must it
 * ask first, or must it refuse outright? The model proposes a purchase; this decides.
 *
 * Why it exists: x402 payments are irreversible and have no refund, so the guardrail has to sit in front
 * of the payment, not behind it.
 */

/** Absolute ceiling for ONE purchase, even with the user's explicit approval. A runaway or confused agent can't exceed it. */
export const HARD_CAP_ATOMIC = 5_000_000n; // $5.00

import { isPayTokenSymbol, type PayTokenSymbol } from './tokens';

export interface BuySettings {
  /** Which dollar stablecoin the user prefers to pay with (falls back to one the wallet holds). */
  payToken: PayTokenSymbol;
  /** The user has switched on autonomous buying. Off by default: every purchase asks first. */
  autonomous: boolean;
  /** Largest single purchase Pexa may make without asking. */
  autoLimitAtomic: bigint;
  /** Total Pexa may spend autonomously per UTC day before it must ask again. */
  dailyBudgetAtomic: bigint;
}

/** Conservative defaults: nothing autonomous until the user opts in, and then only small amounts. */
export const DEFAULT_BUY_SETTINGS: BuySettings = {
  payToken: 'USDC',
  autonomous: false,
  autoLimitAtomic: 100_000n, // $0.10
  dailyBudgetAtomic: 1_000_000n, // $1.00
};

export type BuyDecision =
  | { effect: 'AUTONOMOUS' }
  | { effect: 'CONFIRM'; reason: ConfirmReason; message: string }
  | { effect: 'BLOCK'; reason: BlockReason; message: string };

export type ConfirmReason = 'autonomy_off' | 'not_delegated' | 'over_auto_limit' | 'daily_budget';
export type BlockReason = 'invalid_price' | 'over_hard_cap' | 'insufficient_balance';

export interface BuyFacts {
  priceAtomic: bigint;
  /** Spent today (UTC) across purchases that went out or may have. */
  spentTodayAtomic: bigint;
  /** The wallet's USDC balance. */
  balanceAtomic: bigint;
  /** Whether Pexa can sign server-side for this user (their wallet is delegated and signing is configured). */
  canSignAutonomously: boolean;
}

export function evaluateBuyPurchase(settings: BuySettings, facts: BuyFacts): BuyDecision {
  const { priceAtomic: price } = facts;

  if (price <= 0n) return { effect: 'BLOCK', reason: 'invalid_price', message: 'The quoted price is not valid.' };
  if (price > HARD_CAP_ATOMIC) {
    return { effect: 'BLOCK', reason: 'over_hard_cap', message: 'This is above the $5 per-purchase safety ceiling, so Pexa won’t buy it.' };
  }
  if (facts.balanceAtomic < price) {
    return { effect: 'BLOCK', reason: 'insufficient_balance', message: 'Your wallet doesn’t have enough for this purchase.' };
  }

  // From here the purchase is allowed — the only question is whether Pexa may do it without asking.
  if (!settings.autonomous) {
    return { effect: 'CONFIRM', reason: 'autonomy_off', message: 'Autonomous buying is off, so Pexa is asking first.' };
  }
  if (!facts.canSignAutonomously) {
    return { effect: 'CONFIRM', reason: 'not_delegated', message: 'Pexa can only buy on its own once you enable agent payments in Settings.' };
  }
  if (price > settings.autoLimitAtomic) {
    return { effect: 'CONFIRM', reason: 'over_auto_limit', message: 'This is above your auto-buy limit, so Pexa is asking first.' };
  }
  if (facts.spentTodayAtomic + price > settings.dailyBudgetAtomic) {
    return { effect: 'CONFIRM', reason: 'daily_budget', message: 'This would go over your daily auto-buy budget, so Pexa is asking first.' };
  }
  return { effect: 'AUTONOMOUS' };
}

/** Settings arriving from the UI/API: clamp to sane, safe values (never above the hard cap, never negative). */
export function sanitizeBuySettings(input: { autonomous?: unknown; autoLimitAtomic?: unknown; dailyBudgetAtomic?: unknown; payToken?: unknown }, current: BuySettings): BuySettings {
  const big = (v: unknown, fallback: bigint): bigint => {
    if (typeof v !== 'string' || !/^\d+$/.test(v)) return fallback;
    const n = BigInt(v);
    return n < 0n ? fallback : n;
  };
  const autoLimit = big(input.autoLimitAtomic, current.autoLimitAtomic);
  const budget = big(input.dailyBudgetAtomic, current.dailyBudgetAtomic);
  return {
    payToken: isPayTokenSymbol(input.payToken) ? input.payToken : current.payToken,
    autonomous: typeof input.autonomous === 'boolean' ? input.autonomous : current.autonomous,
    autoLimitAtomic: autoLimit > HARD_CAP_ATOMIC ? HARD_CAP_ATOMIC : autoLimit,
    // The daily budget can't be smaller than one auto purchase, or autonomy could never trigger.
    dailyBudgetAtomic: budget < autoLimit ? autoLimit : budget > 50_000_000n ? 50_000_000n : budget,
  };
}
