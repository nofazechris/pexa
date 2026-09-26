import { describe, expect, it } from 'vitest';
import { computeAvailableRaw, vaultProgress } from './service';

describe('computeAvailableRaw', () => {
  it('subtracts earmarked from on-chain', () => {
    expect(computeAvailableRaw('1000000', 400000n)).toBe(600000n); // 1.00 − 0.40 = 0.60 USDC
  });

  it('floors at zero when earmarked exceeds on-chain (never negative)', () => {
    expect(computeAvailableRaw('300000', 500000n)).toBe(0n);
  });

  it('returns the full balance when nothing is earmarked', () => {
    expect(computeAvailableRaw('2500000', 0n)).toBe(2500000n);
  });
});

describe('vaultProgress', () => {
  it('is null without a target', () => {
    expect(vaultProgress('500000', null)).toBeNull();
  });

  it('reports fractional progress toward a goal', () => {
    expect(vaultProgress('250000', '1000000')).toBeCloseTo(0.25); // 0.25 / 1.00
  });

  it('caps at 1 once the goal is met or exceeded', () => {
    expect(vaultProgress('1500000', '1000000')).toBe(1);
  });

  it('is null for a non-positive target', () => {
    expect(vaultProgress('100000', '0')).toBeNull();
  });
});
