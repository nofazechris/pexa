import { describe, expect, it } from 'vitest';
import { usatOfferFor } from './offer';
import { parseSwapIntent } from './intent';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const dep = (amount: string, token: string, hoursAgo: number) => ({ amount, token, at: new Date(NOW - hoursAgo * 3600_000).toISOString() });

describe('offering USAT for a fresh deposit', () => {
  it('offers the newest recent USDC deposit', () => {
    const o = usatOfferFor([dep('5', 'USDC', 30), dep('12.5', 'USDC', 1)], NOW);
    expect(o?.amount).toBe('12.5');
    expect(o?.options.map((x) => x.label)).toEqual(['Turn $12.5 into USAT', 'Keep it as USDC']);
  });
  it('the convert button is an ordinary conversion request', () => {
    const o = usatOfferFor([dep('12.5', 'USDC', 1)], NOW)!;
    expect(parseSwapIntent(o.options[0].text)).toMatchObject({ kind: 'swap', from: 'USDC', to: 'USAT', amount: '12.5' });
  });
  it('"keep it" is not a conversion', () => {
    expect(parseSwapIntent('Keep it as USDC').kind).toBe('none');
  });
  it('offers nothing for old deposits, other coins, or amounts a conversion can’t take', () => {
    expect(usatOfferFor([dep('12', 'USDC', 48)], NOW)).toBeNull();
    expect(usatOfferFor([dep('12', 'USAT', 1)], NOW)).toBeNull();
    expect(usatOfferFor([dep('0.05', 'USDC', 1)], NOW)).toBeNull();
    expect(usatOfferFor([dep('900', 'USDC', 1)], NOW)).toBeNull();
    expect(usatOfferFor([], NOW)).toBeNull();
  });
});
