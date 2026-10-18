import { SWAP_LIMITS } from './route';

/**
 * When a deposit has just landed as USDC, offer to turn it into USAT (or keep it). The offer is two buttons; "convert" sends an
 * ordinary conversion request, so the usual quote card and Confirm still stand between the offer and any money moving.
 *
 * Pure.
 */

export interface DepositSeen {
  amount: string;
  token: string;
  /** ISO time it arrived. */
  at: string;
}

export interface UsatOffer {
  amount: string;
  options: { label: string; text: string }[];
}

const FRESH_MS = 24 * 3600_000;

/** The newest USDC deposit from the last day that is within what a conversion allows, or null. */
export function usatOfferFor(deposits: readonly DepositSeen[], now: number): UsatOffer | null {
  const latest = deposits
    .filter((d) => d.token.toUpperCase() === 'USDC' && now - Date.parse(d.at) <= FRESH_MS && now >= Date.parse(d.at))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  if (!latest) return null;
  const atomic = BigInt(Math.round(Number(latest.amount) * 1_000_000));
  if (!Number.isFinite(Number(latest.amount)) || atomic < SWAP_LIMITS.minAtomic || atomic > SWAP_LIMITS.maxAtomic) return null;
  const amount = String(Number(latest.amount));
  return {
    amount,
    options: [
      { label: `Turn $${amount} into USAT`, text: `Convert ${amount} USDC to USAT` },
      { label: 'Keep it as USDC', text: 'Keep it as USDC' },
    ],
  };
}
