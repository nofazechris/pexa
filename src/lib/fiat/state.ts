/**
 * Fiat order state machines (§19).
 *
 * Two explicit enums with fixed legal transitions — one for NGN→USDT (buy) and one for
 * USDT→NGN (sell) — mirroring the payment state machine. This is the single source of truth for
 * how a fiat order may move; transitions are driven only by the backend (order service +
 * verified provider webhooks), never by the AI layer, and any illegal move fails loudly.
 *
 * Pure data and pure guards — no side effects, safe to unit test in isolation.
 */

import type { OrderSide } from './provider';

/* -------------------------------------------------------------------- NGN → USDT (buy) */

export const BUY_STATUSES = [
  'QUOTE_CREATED',
  'AWAITING_FUNDING',
  'FUNDING_RECEIVED',
  'PROCESSING',
  'SETTLED',
  // terminal alternates
  'EXPIRED',
  'FAILED',
  'REFUNDED',
  'CANCELLED',
] as const;

export type BuyStatus = (typeof BUY_STATUSES)[number];

const BUY_TRANSITIONS: Record<BuyStatus, readonly BuyStatus[]> = {
  QUOTE_CREATED: ['AWAITING_FUNDING', 'EXPIRED', 'CANCELLED'],
  AWAITING_FUNDING: ['FUNDING_RECEIVED', 'EXPIRED', 'CANCELLED', 'FAILED'],
  FUNDING_RECEIVED: ['PROCESSING', 'REFUNDED', 'FAILED'],
  PROCESSING: ['SETTLED', 'FAILED', 'REFUNDED'],
  SETTLED: [],
  EXPIRED: [],
  FAILED: ['REFUNDED'], // a failed, funded order may still be refunded
  REFUNDED: [],
  CANCELLED: [],
};

/* -------------------------------------------------------------------- USDT → NGN (sell) */

export const SELL_STATUSES = [
  'QUOTE_CREATED',
  'AWAITING_ASSET',
  'ASSET_RECEIVED',
  'PROCESSING',
  'PAYOUT_PROCESSING',
  'PAID',
  // terminal alternates
  'EXPIRED',
  'FAILED',
  'REVERSED',
  'REFUNDED',
] as const;

export type SellStatus = (typeof SELL_STATUSES)[number];

const SELL_TRANSITIONS: Record<SellStatus, readonly SellStatus[]> = {
  QUOTE_CREATED: ['AWAITING_ASSET', 'EXPIRED', 'FAILED'],
  AWAITING_ASSET: ['ASSET_RECEIVED', 'EXPIRED', 'FAILED'],
  ASSET_RECEIVED: ['PROCESSING', 'REFUNDED', 'FAILED'],
  PROCESSING: ['PAYOUT_PROCESSING', 'FAILED', 'REFUNDED'],
  PAYOUT_PROCESSING: ['PAID', 'FAILED', 'REVERSED'],
  PAID: ['REVERSED'], // a completed payout can still be reversed by the bank/provider
  EXPIRED: [],
  FAILED: ['REFUNDED'],
  REVERSED: [],
  REFUNDED: [],
};

/* ------------------------------------------------------------------------------ helpers */

export type FiatOrderStatus = BuyStatus | SellStatus;

const TERMINAL_BUY: readonly BuyStatus[] = ['SETTLED', 'EXPIRED', 'FAILED', 'REFUNDED', 'CANCELLED'];
const TERMINAL_SELL: readonly SellStatus[] = ['PAID', 'EXPIRED', 'FAILED', 'REVERSED', 'REFUNDED'];

export function isTerminal(side: OrderSide, status: FiatOrderStatus): boolean {
  return side === 'buy'
    ? TERMINAL_BUY.includes(status as BuyStatus)
    : TERMINAL_SELL.includes(status as SellStatus);
}

export function canTransition(side: OrderSide, from: FiatOrderStatus, to: FiatOrderStatus): boolean {
  const map = side === 'buy' ? BUY_TRANSITIONS : SELL_TRANSITIONS;
  const outgoing = (map as Record<string, readonly string[]>)[from];
  return Boolean(outgoing?.includes(to));
}

/** Assert a transition is legal, returning the target. Throws otherwise — the order service uses
 *  this so an illegal (or AI-driven) state change fails loudly instead of corrupting an order. */
export function assertTransition(side: OrderSide, from: FiatOrderStatus, to: FiatOrderStatus): FiatOrderStatus {
  if (!canTransition(side, from, to)) {
    throw new Error(`Illegal ${side} fiat-order transition: ${from} → ${to}`);
  }
  return to;
}

/** Whether `to` is reachable from `from` via legal transitions. A verified webhook may report a
 *  later state directly (e.g. AWAITING_FUNDING → SETTLED); this confirms that jump is legitimate
 *  before we apply it, so the AI/webhook can never drive an order somewhere the machine forbids. */
export function canReach(side: OrderSide, from: FiatOrderStatus, to: FiatOrderStatus): boolean {
  if (from === to) return true;
  const map = side === 'buy' ? BUY_TRANSITIONS : SELL_TRANSITIONS;
  const seen = new Set<string>([from]);
  const queue: string[] = [from];
  while (queue.length) {
    const cur = queue.shift() as FiatOrderStatus;
    for (const next of (map as Record<string, readonly string[]>)[cur] ?? []) {
      if (next === to) return true;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/** Whether a status string is valid for the given side. */
export function isValidStatus(side: OrderSide, status: string): status is FiatOrderStatus {
  return (side === 'buy' ? (BUY_STATUSES as readonly string[]) : (SELL_STATUSES as readonly string[])).includes(status);
}
