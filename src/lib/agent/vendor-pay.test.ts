import { describe, expect, it } from 'vitest';
import { VENDOR_PAY_REPLY, isVendorPaymentRequest } from './buy-intent';

const shortlist = { role: 'assistant' as const, content: '[Showed a vendor shortlist for sneakers in Lagos: @fair_kicks (looks solid). Each card shows ratings.]' };
const u = (content: string) => ({ role: 'user' as const, content });

describe('isVendorPaymentRequest', () => {
  it.each(['ok pay this vendor for me', 'pay the seller', 'can you pay them', 'transfer the money to him', 'pay the first one', 'buy from this vendor', 'settle up with the plug'])('"%s" after a shortlist → yes', (text) => {
    expect(isVendorPaymentRequest([u('find me a sneaker vendor in Lagos'), shortlist, u(text)])).toBe(true);
  });
  it('an explicit @username or wallet address is a normal send between people, not this', () => {
    expect(isVendorPaymentRequest([shortlist, u('pay @chris 5 USDC')])).toBe(false);
    expect(isVendorPaymentRequest([shortlist, u('pay the vendor 0x52c23C312B27c8361BC37E7c8429F0328c7F5F2A 5 USDC')])).toBe(false);
  });
  it('is not triggered without a shortlist on screen', () => {
    expect(isVendorPaymentRequest([u('ok pay this vendor for me')])).toBe(false);
    expect(isVendorPaymentRequest([{ role: 'assistant', content: 'Hi! How can I help?' }, u('pay the seller')])).toBe(false);
  });
  it('is not triggered by questions that merely mention paying', () => {
    expect(isVendorPaymentRequest([shortlist, u('what price should I offer the vendor?')])).toBe(false);
    expect(isVendorPaymentRequest([shortlist, u('which one should I pick?')])).toBe(false);
  });
  it('the reply is honest about what Pexa does', () => {
    expect(VENDOR_PAY_REPLY).toMatch(/can’t pay vendors/);
    expect(VENDOR_PAY_REPLY).toMatch(/research agent/);
  });
});
