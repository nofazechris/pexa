import { describe, expect, it } from 'vitest';
import { PAY_TOKENS, chooseToken, isPayTokenSymbol, payTokenByAddress } from './tokens';

const P = 6000n;

describe('pay tokens', () => {
  it('knows its three tokens by address, case-insensitively', () => {
    expect(payTokenByAddress(PAY_TOKENS.USAT.address.toLowerCase())?.symbol).toBe('USAT');
    expect(payTokenByAddress('0x0000000000000000000000000000000000000001')).toBeNull();
  });
  it('validates symbols strictly', () => {
    expect(isPayTokenSymbol('USAT')).toBe(true);
    expect(isPayTokenSymbol('DAI')).toBe(false);
    expect(isPayTokenSymbol('toString')).toBe(false);
  });
});

describe('chooseToken', () => {
  const all = ['USDC', 'USDT', 'USAT'] as const;

  it('uses the preferred token when it is offered and funded', () => {
    const r = chooseToken({ preferred: 'USAT', offered: all, balances: { USAT: 10_000n, USDC: 99_000_000n }, priceAtomic: P });
    expect(r).toMatchObject({ ok: true, switched: false });
    expect(r.ok && r.token.symbol).toBe('USAT');
  });

  it('falls back to the funded token when the preferred one is empty, and says it switched', () => {
    const r = chooseToken({ preferred: 'USAT', offered: all, balances: { USAT: 0n, USDC: 50_000n }, priceAtomic: P });
    expect(r.ok && r.token.symbol).toBe('USDC');
    expect(r.ok && r.switched).toBe(true);
  });

  it('prefers the larger balance among fallbacks', () => {
    const r = chooseToken({ preferred: 'USAT', offered: all, balances: { USDC: 10_000n, USDT: 900_000n }, priceAtomic: P });
    expect(r.ok && r.token.symbol).toBe('USDT');
  });

  it('never picks a token the service does not offer', () => {
    const r = chooseToken({ preferred: 'USAT', offered: ['USDC'], balances: { USAT: 99_000_000n, USDC: 10_000n }, priceAtomic: P });
    expect(r.ok && r.token.symbol).toBe('USDC');
  });

  it('reports insufficient funds, listing what the wallet does hold', () => {
    const r = chooseToken({ preferred: 'USDC', offered: all, balances: { USDC: 100n, USAT: 5n }, priceAtomic: P });
    expect(r).toEqual({ ok: false, reason: 'insufficient', holdings: ['USDC', 'USAT'] });
  });

  it('reports when nothing we can pay with is offered', () => {
    expect(chooseToken({ preferred: 'USDC', offered: [], balances: {}, priceAtomic: P })).toMatchObject({ ok: false, reason: 'not_offered' });
  });

  it('pays exactly at the balance boundary', () => {
    const r = chooseToken({ preferred: 'USDC', offered: all, balances: { USDC: P }, priceAtomic: P });
    expect(r.ok).toBe(true);
  });
});
