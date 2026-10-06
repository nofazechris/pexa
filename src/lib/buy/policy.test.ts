import { describe, expect, it } from 'vitest';
import { DEFAULT_BUY_SETTINGS, HARD_CAP_ATOMIC, evaluateBuyPurchase, sanitizeBuySettings, type BuyFacts, type BuySettings } from './policy';

const ON: BuySettings = { payToken: 'USDC', autonomous: true, autoLimitAtomic: 100_000n, dailyBudgetAtomic: 1_000_000n };
const facts = (over: Partial<BuyFacts> = {}): BuyFacts => ({
  priceAtomic: 3_606n,
  spentTodayAtomic: 0n,
  balanceAtomic: 5_000_000n,
  canSignAutonomously: true,
  ...over,
});

describe('evaluateBuyPurchase', () => {
  it('buys on its own when autonomy is on, delegated, within the auto-limit and the daily budget', () => {
    expect(evaluateBuyPurchase(ON, facts())).toEqual({ effect: 'AUTONOMOUS' });
  });

  it('asks first by default — autonomy is opt-in', () => {
    const d = evaluateBuyPurchase(DEFAULT_BUY_SETTINGS, facts());
    expect(d).toMatchObject({ effect: 'CONFIRM', reason: 'autonomy_off' });
  });

  it('asks first when Pexa cannot sign for the user server-side', () => {
    expect(evaluateBuyPurchase(ON, facts({ canSignAutonomously: false }))).toMatchObject({ effect: 'CONFIRM', reason: 'not_delegated' });
  });

  it('asks first above the auto-limit — and exactly at the limit is still automatic', () => {
    expect(evaluateBuyPurchase(ON, facts({ priceAtomic: 100_001n }))).toMatchObject({ effect: 'CONFIRM', reason: 'over_auto_limit' });
    expect(evaluateBuyPurchase(ON, facts({ priceAtomic: 100_000n }))).toEqual({ effect: 'AUTONOMOUS' });
  });

  it('asks first once the day’s budget would be exceeded', () => {
    expect(evaluateBuyPurchase(ON, facts({ priceAtomic: 100_000n, spentTodayAtomic: 950_000n }))).toMatchObject({ effect: 'CONFIRM', reason: 'daily_budget' });
    expect(evaluateBuyPurchase(ON, facts({ priceAtomic: 100_000n, spentTodayAtomic: 900_000n }))).toEqual({ effect: 'AUTONOMOUS' });
  });

  it('refuses outright above the $5 hard ceiling — even if the user would approve', () => {
    const d = evaluateBuyPurchase(ON, facts({ priceAtomic: HARD_CAP_ATOMIC + 1n, balanceAtomic: 100_000_000n }));
    expect(d).toMatchObject({ effect: 'BLOCK', reason: 'over_hard_cap' });
    expect(evaluateBuyPurchase(ON, facts({ priceAtomic: HARD_CAP_ATOMIC, balanceAtomic: 100_000_000n })).effect).toBe('CONFIRM');
  });

  it('refuses when the wallet cannot cover it, and on nonsense prices', () => {
    expect(evaluateBuyPurchase(ON, facts({ balanceAtomic: 1_000n }))).toMatchObject({ effect: 'BLOCK', reason: 'insufficient_balance' });
    expect(evaluateBuyPurchase(ON, facts({ priceAtomic: 0n }))).toMatchObject({ effect: 'BLOCK', reason: 'invalid_price' });
    expect(evaluateBuyPurchase(ON, facts({ priceAtomic: -5n }))).toMatchObject({ effect: 'BLOCK', reason: 'invalid_price' });
  });

  it('a block always wins over autonomy (a cheap-looking purchase can’t slip past a balance check)', () => {
    expect(evaluateBuyPurchase(ON, facts({ priceAtomic: 10_000n, balanceAtomic: 5_000n })).effect).toBe('BLOCK');
  });
});

describe('sanitizeBuySettings', () => {
  it('applies valid changes', () => {
    const s = sanitizeBuySettings({ autonomous: true, autoLimitAtomic: '250000', dailyBudgetAtomic: '2000000' }, DEFAULT_BUY_SETTINGS);
    expect(s).toEqual({ payToken: 'USDC', autonomous: true, autoLimitAtomic: 250_000n, dailyBudgetAtomic: 2_000_000n });
  });

  it('clamps the auto-limit to the hard cap and the budget to a sane maximum', () => {
    const s = sanitizeBuySettings({ autoLimitAtomic: '999999999', dailyBudgetAtomic: '999999999999' }, ON);
    expect(s.autoLimitAtomic).toBe(HARD_CAP_ATOMIC);
    expect(s.dailyBudgetAtomic).toBe(50_000_000n);
  });

  it('never lets the daily budget be smaller than one auto purchase', () => {
    const s = sanitizeBuySettings({ autoLimitAtomic: '500000', dailyBudgetAtomic: '1000' }, ON);
    expect(s.dailyBudgetAtomic).toBe(500_000n);
  });

  it('ignores junk and keeps current values', () => {
    const s = sanitizeBuySettings({ autonomous: 'yes', autoLimitAtomic: '-5', dailyBudgetAtomic: 12.5 }, ON);
    expect(s).toEqual(ON);
  });
});

describe('payToken setting', () => {
  it('accepts only the supported stablecoins and keeps the current one otherwise', () => {
    expect(sanitizeBuySettings({ payToken: 'USAT' }, DEFAULT_BUY_SETTINGS).payToken).toBe('USAT');
    expect(sanitizeBuySettings({ payToken: 'DAI' }, { ...DEFAULT_BUY_SETTINGS, payToken: 'USDT' }).payToken).toBe('USDT');
    expect(sanitizeBuySettings({ payToken: 42 }, DEFAULT_BUY_SETTINGS).payToken).toBe('USDC');
  });
});
