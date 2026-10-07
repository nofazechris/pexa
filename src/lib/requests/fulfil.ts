/**
 * Can this payment settle this payment request? The payer's browser says "I paid it" — that claim is never
 * enough. The payment must exist, be the payer's own, go to the person who asked, cover the amount, use the
 * same token and network, and be really on its way or done. Otherwise anyone could mark a merchant's request as
 * PAID without sending a cent. Pure so it can be tested exhaustively.
 */

export interface PaymentFacts {
  senderUserId: string;
  recipientUserId: string | null;
  amount: string;
  token: string;
  chainId: number;
  status: string;
}

export interface RequestFacts {
  requesterUserId: string;
  payerUserId: string;
  amount: string;
  token: string;
  chainId: number;
}

/** Statuses that mean the money is actually moving or arrived. A draft, preview or cancelled payment is not. */
const SETTLING = new Set(['PENDING', 'CONFIRMED']);

export type FulfilResult = { ok: true } | { ok: false; reason: 'wrong_payer' | 'wrong_recipient' | 'wrong_token' | 'too_little' | 'not_sent' };

export function paymentFulfilsRequest(payment: PaymentFacts, request: RequestFacts): FulfilResult {
  if (payment.senderUserId !== request.payerUserId) return { ok: false, reason: 'wrong_payer' };
  if (!payment.recipientUserId || payment.recipientUserId !== request.requesterUserId) return { ok: false, reason: 'wrong_recipient' };
  if (payment.token !== request.token || payment.chainId !== request.chainId) return { ok: false, reason: 'wrong_token' };
  try {
    if (BigInt(payment.amount) < BigInt(request.amount)) return { ok: false, reason: 'too_little' };
  } catch {
    return { ok: false, reason: 'too_little' };
  }
  if (!SETTLING.has(payment.status)) return { ok: false, reason: 'not_sent' };
  return { ok: true };
}
