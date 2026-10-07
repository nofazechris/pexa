import type { PaymentStatus } from './state';

/**
 * Which payments belong in a person's Activity / "recent payments". A payment someone merely previewed or
 * cancelled never moved money and is not a transaction; showing it makes the list look like it is full of
 * stuck payments. And a person only sees money that really moved TOWARD them, never the sender's drafts.
 */

/** Payments you sent: anything past the preview stage, including failures (you want to know about those). */
export const OUTGOING_VISIBLE: readonly PaymentStatus[] = ['AUTHORIZED', 'PREPARING', 'SIGNING', 'BROADCASTING', 'PENDING', 'CONFIRMED', 'FAILED'];

/** Payments sent to you: only once the money is actually on its way or arrived. */
export const INCOMING_VISIBLE: readonly PaymentStatus[] = ['BROADCASTING', 'PENDING', 'CONFIRMED'];

export function isVisibleInActivity(status: PaymentStatus, direction: 'out' | 'in'): boolean {
  return (direction === 'out' ? OUTGOING_VISIBLE : INCOMING_VISIBLE).includes(status);
}
