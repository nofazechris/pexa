import { describe, expect, it } from 'vitest';
import { currencyForPlace, extractPrices, money, niceAmount, rangeText, summarize, versus } from './price';

const amounts = (text: string, fallback: Parameters<typeof extractPrices>[1] = null) => extractPrices(text, fallback).map((p) => `${p.currency}${p.amount}`);

describe('extractPrices: the ways sellers write prices', () => {
  it.each([
    ['Air Force 1 now ₦45,000', ['NGN45000']],
    ['Slides #15,000 only', ['NGN15000']],
    ['Gucci bag N85k', ['NGN85000']],
    ['Wig 120k naira', ['NGN120000']],
    ['Price: ₦1.2m', ['NGN1200000']],
    ['Sneakers $40 each', ['USD40']],
    ['Hoodie 25,000 NGN', ['NGN25000']],
    ['Phone cases KSh 1,500', ['KES1500']],
    ['Dress GH₵250', ['GHS250']],
    ['Shoe ₦25,000 / bag ₦60,000', ['NGN25000', 'NGN60000']],
  ])('%s', (text, want) => expect(amounts(text)).toEqual(want));

  it('reads a bare "Price: 25000" only when the currency is known from the place', () => {
    expect(amounts('Price: 25000')).toEqual([]);
    expect(amounts('Price: 25000', 'NGN')).toEqual(['NGN25000']);
    expect(amounts('only 18k', 'NGN')).toEqual(['NGN18000']);
  });

  it('does not take phone numbers, years, counts or hashtags for prices', () => {
    expect(amounts('Call 08012345678 or +234 801 234 5678', 'NGN')).toEqual([]);
    expect(amounts('Since 2019 · 12,000 followers · #1 seller in Lagos', 'NGN')).toEqual([]);
    expect(amounts('Order N 08012345678 now')).toEqual([]);
  });

  it('never counts the same number twice', () => {
    expect(amounts('₦25,000 naira')).toEqual(['NGN25000']);
  });
  it('handles empty input', () => {
    expect(extractPrices(null)).toEqual([]);
    expect(extractPrices('')).toEqual([]);
  });
});

describe('summaries', () => {
  const pts = (...xs: number[]) => xs.map((amount) => ({ amount, currency: 'NGN' as const }));
  it('gives the range and the middle in the currency used most', () => {
    expect(summarize(pts(20000, 30000, 40000, 50000))).toMatchObject({ currency: 'NGN', low: 20000, high: 50000, median: 35000, n: 4 });
    const mixed = summarize([...pts(10000, 20000, 30000), { amount: 50, currency: 'USD' }]);
    expect(mixed?.currency).toBe('NGN');
    expect(mixed?.n).toBe(3);
  });
  it('ignores one wild price once there are enough to trim', () => {
    const s = summarize(pts(30000, 31000, 32000, 33000, 34000, 35000, 36000, 37000, 38000, 39000, 5_000_000));
    expect(s!.high).toBeLessThan(500_000);
  });
  it('is null with nothing', () => expect(summarize([])).toBeNull());

  it('says prices the way people do', () => {
    expect([money(850, 'NGN'), money(1500, 'NGN'), money(38000, 'NGN'), money(125000, 'NGN'), money(1_200_000, 'NGN'), money(40, 'USD')]).toEqual(['₦850', '₦1.5k', '₦38k', '₦125k', '₦1.2m', '$40']);
    expect(rangeText({ currency: 'NGN', low: 25000, median: 38000, high: 60000, n: 6 })).toBe('₦25k–₦60k');
    expect(rangeText({ currency: 'NGN', low: 25000, median: 25000, high: 25000, n: 2 })).toBe('₦25k');
  });
  it('rounds offers to numbers a person would say', () => {
    expect([niceAmount(38_400), niceAmount(127_300), niceAmount(1_180_000), niceAmount(4_460), niceAmount(870)]).toEqual([38_000, 125_000, 1_200_000, 4_500, 870]);
  });
  it('knows the likely currency of a city', () => {
    expect([currencyForPlace('Yaba, Lagos'), currencyForPlace('Nairobi'), currencyForPlace('Accra'), currencyForPlace('Oslo')]).toEqual(['NGN', 'KES', 'GHS', null]);
  });
  it('compares a seller to the typical price', () => {
    const market = { currency: 'NGN' as const, low: 25000, median: 38000, high: 60000, n: 8 };
    expect(versus({ ...market, median: 45000 }, market)).toEqual({ kind: 'above', percent: 18 });
    expect(versus({ ...market, median: 30000 }, market)).toEqual({ kind: 'below', percent: -21 });
    expect(versus({ ...market, median: 39000 }, market)).toMatchObject({ kind: 'near' });
    expect(versus({ ...market, currency: 'USD' }, market)).toBeNull();
  });
});
