import { describe, it, expect } from 'vitest';
import { SandboxFiatProvider } from './sandbox';

// Sandbox reference rate is ₦1,612 / USDT. All amounts are smallest units: NGN kobo, USDT 6dp.
describe('sandbox fiat provider quotes', () => {
  const provider = new SandboxFiatProvider();

  it('is clearly marked as sandbox', () => {
    expect(provider.sandbox).toBe(true);
  });

  it('quotes a buy (₦100,000) net of a 0.5% fee', async () => {
    const q = await provider.getQuote({ side: 'buy', amount: '10000000', amountCurrency: 'NGN' });
    expect(q.side).toBe('buy');
    expect(q.sandbox).toBe(true);
    expect(q.ngnAmount).toBe('10000000'); // ₦100,000 in kobo
    expect(q.providerFeeNgn).toBe('50000'); // 0.5% = ₦500
    expect(q.estimatedReceiveCurrency).toBe('USDT');
    // net ₦99,500 → 9,950,000 kobo / 161,200 kobo-per-USDT × 1e6 = 61,724,565 (6dp) units.
    expect(q.usdtAmount).toBe('61724565');
    expect(q.estimatedReceive).toBe(q.usdtAmount);
    expect(new Date(q.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('quotes a sell (100 USDT) net of a 0.5% fee', async () => {
    const q = await provider.getQuote({ side: 'sell', amount: '100000000', amountCurrency: 'USDT' });
    expect(q.side).toBe('sell');
    expect(q.ngnAmount).toBe('16120000'); // 100 × ₦1,612 = ₦161,200 in kobo
    expect(q.providerFeeNgn).toBe('80600'); // 0.5% of ₦161,200 = ₦806
    expect(q.estimatedReceiveCurrency).toBe('NGN');
    expect(q.estimatedReceive).toBe('16039400'); // ₦160,394 in kobo
  });

  it('rejects a webhook with no signature', async () => {
    const res = await provider.handleWebhook('{"id":"e1","type":"order.settled","status":"SETTLED"}', null);
    expect(res.valid).toBe(false);
  });
});
