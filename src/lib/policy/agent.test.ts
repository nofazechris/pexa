import { describe, it, expect } from 'vitest';
import { evaluateAgentPolicy, type AgentPolicySnapshot } from './agent';

// A baseline snapshot that would ALLOW; each test overrides one field to exercise a check.
// Amounts in kobo: ₦50,000 order, limits ₦1,000 / ₦1,000,000 / ₦2,000,000 / ₦10,000,000.
function base(over: Partial<AgentPolicySnapshot> = {}): AgentPolicySnapshot {
  return {
    fiatEnabled: true,
    action: 'buy',
    ngnAmount: '5000000',
    minOrderNgn: '100000',
    perOrderNgn: '100000000',
    dailyNgn: '200000000',
    monthlyNgn: '1000000000',
    spentTodayNgn: '0',
    spentMonthNgn: '0',
    kycStatus: 'verified',
    blocked: false,
    quoteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    confirmed: true,
    now: Date.now(),
    ...over,
  };
}

describe('agent policy engine (fiat)', () => {
  it('ALLOWs a fully valid, confirmed action', () => {
    expect(evaluateAgentPolicy(base()).effect).toBe('ALLOW');
  });

  it('REQUIRE_CONFIRMATION when not yet confirmed', () => {
    const r = evaluateAgentPolicy(base({ confirmed: false }));
    expect(r.effect).toBe('REQUIRE_CONFIRMATION');
    expect(r.check).toBe('confirmation');
  });

  it('BLOCKs when fiat is disabled', () => {
    expect(evaluateAgentPolicy(base({ fiatEnabled: false })).check).toBe('fiat_enabled');
  });

  it('BLOCKs below the minimum order size', () => {
    expect(evaluateAgentPolicy(base({ ngnAmount: '50000' })).check).toBe('min_order');
  });

  it('BLOCKs above the per-order limit', () => {
    expect(evaluateAgentPolicy(base({ ngnAmount: '200000000' })).check).toBe('per_order_limit');
  });

  it('BLOCKs an expired quote', () => {
    const r = evaluateAgentPolicy(base({ quoteExpiresAt: new Date(Date.now() - 1000).toISOString() }));
    expect(r.effect).toBe('BLOCK');
    expect(r.check).toBe('quote_valid');
  });

  it('REQUIRE_KYC when not verified', () => {
    for (const kyc of ['none', 'pending', 'rejected'] as const) {
      expect(evaluateAgentPolicy(base({ kycStatus: kyc })).effect).toBe('REQUIRE_KYC');
    }
  });

  it('BLOCKs a risk-flagged account', () => {
    expect(evaluateAgentPolicy(base({ blocked: true })).check).toBe('risk');
  });

  it('BLOCKs when the daily limit would be exceeded', () => {
    // ₦1,999,999.99 already spent today; a ₦50,000 order tips over ₦2,000,000.
    const r = evaluateAgentPolicy(base({ spentTodayNgn: '199999999' }));
    expect(r.check).toBe('daily_limit');
  });

  it('BLOCKs when the monthly limit would be exceeded', () => {
    const r = evaluateAgentPolicy(base({ spentMonthNgn: '999999999' }));
    expect(r.check).toBe('monthly_limit');
  });

  it('rejects a malformed amount', () => {
    expect(evaluateAgentPolicy(base({ ngnAmount: 'abc' })).check).toBe('valid_amount');
  });

  it('enforces checks in priority order (fiat_enabled before amount)', () => {
    expect(evaluateAgentPolicy(base({ fiatEnabled: false, ngnAmount: '0' })).check).toBe('fiat_enabled');
  });
});
