import { describe, expect, it } from 'vitest';
import { coinNamed, coinsNamed } from './coin';

describe('the coin the person named', () => {
  it('reads one coin', () => {
    expect(coinNamed('where can I earn on my USDC on Celo?')).toBe('USDC');
    expect(coinNamed('best yield for my usdt')).toBe('USDT');
    expect(coinNamed('can I earn interest on USAT')).toBe('USAT');
    expect(coinNamed('what about tether?')).toBe('USDT');
    expect(coinNamed('earn on my USD₮')).toBe('USDT');
    expect(coinNamed('where can I earn on my USDC on Celo?')).toBe('USDC'); // Celo is the chain, not a second coin
  });
  it('assumes nothing when they name two coins, or none', () => {
    expect(coinNamed('should I use USDC or USDT?')).toBeNull();
    expect(coinNamed('best yield on Base')).toBeNull();
    expect(coinNamed('where can I earn?')).toBeNull();
  });
  it('lists them in order without repeats', () => {
    expect(coinsNamed('USDC, usdt, USDC again and ETH')).toEqual(['USDC', 'USDT', 'ETH']);
  });
});
