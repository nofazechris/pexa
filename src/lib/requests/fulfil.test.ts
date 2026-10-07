import { describe, expect, it } from 'vitest';
import { paymentFulfilsRequest, type PaymentFacts, type RequestFacts } from './fulfil';

const request: RequestFacts = { requesterUserId: 'merchant', payerUserId: 'buyer', amount: '50000000', token: 'USDC', chainId: 42220 };
const payment: PaymentFacts = { senderUserId: 'buyer', recipientUserId: 'merchant', amount: '50000000', token: 'USDC', chainId: 42220, status: 'CONFIRMED' };

describe('paymentFulfilsRequest — "I paid" must be backed by a real, matching payment', () => {
  it('accepts a genuine payment (confirmed or in flight), including an overpayment', () => {
    expect(paymentFulfilsRequest(payment, request)).toEqual({ ok: true });
    expect(paymentFulfilsRequest({ ...payment, status: 'PENDING' }, request)).toEqual({ ok: true });
    expect(paymentFulfilsRequest({ ...payment, amount: '60000000' }, request)).toEqual({ ok: true });
  });

  it('rejects a payment made by somebody else', () => {
    expect(paymentFulfilsRequest({ ...payment, senderUserId: 'stranger' }, request)).toEqual({ ok: false, reason: 'wrong_payer' });
  });

  it('rejects a payment that went to someone other than the requester — or to no Pexa user at all', () => {
    expect(paymentFulfilsRequest({ ...payment, recipientUserId: 'someone-else' }, request)).toEqual({ ok: false, reason: 'wrong_recipient' });
    expect(paymentFulfilsRequest({ ...payment, recipientUserId: null }, request)).toEqual({ ok: false, reason: 'wrong_recipient' });
  });

  it('rejects an underpayment, however small the shortfall', () => {
    expect(paymentFulfilsRequest({ ...payment, amount: '49999999' }, request)).toEqual({ ok: false, reason: 'too_little' });
    expect(paymentFulfilsRequest({ ...payment, amount: '1' }, request)).toEqual({ ok: false, reason: 'too_little' });
    expect(paymentFulfilsRequest({ ...payment, amount: 'not-a-number' }, request)).toEqual({ ok: false, reason: 'too_little' });
  });

  it('rejects the wrong token or network', () => {
    expect(paymentFulfilsRequest({ ...payment, token: 'USDT' }, request)).toEqual({ ok: false, reason: 'wrong_token' });
    expect(paymentFulfilsRequest({ ...payment, chainId: 11142220 }, request)).toEqual({ ok: false, reason: 'wrong_token' });
  });

  it('rejects a payment that never actually went out (preview, draft, authorized-only, failed, cancelled)', () => {
    for (const status of ['DRAFT', 'PREVIEW', 'AWAITING_AUTHORIZATION', 'AUTHORIZED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REJECTED']) {
      expect(paymentFulfilsRequest({ ...payment, status }, request)).toEqual({ ok: false, reason: 'not_sent' });
    }
  });
});
