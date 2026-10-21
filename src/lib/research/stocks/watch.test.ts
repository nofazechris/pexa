import { describe, expect, it } from 'vitest';
import { ALERT_COOLDOWN_MS, detectPriceMoves, priceSince, talkSince, tractionChange, withoutRecent } from './watch';
import type { PriceStats } from './prices';

const price = (last: number, over: Partial<PriceStats> = {}): PriceStats => ({ symbol: 'NVDA', name: 'NVIDIA', currency: 'USD', last, ret1w: 1, ret1m: 2, ret3m: -4, retYtd: 10, ret1y: 20, vol: 30, drawdown3m: 5, exchange: 'NasdaqGS', ...over });

describe('price alerts', () => {
  it('nothing for a quiet stock', () => {
    expect(detectPriceMoves('NVDA', 200, price(205))).toEqual([]);
    expect(detectPriceMoves('NVDA', 200, price(185))).toEqual([]);
  });
  it('a big rise or fall since the last alert, in plain words', () => {
    const up = detectPriceMoves('NVDA', 200, price(228));
    expect(up[0].kind).toBe('price_up');
    expect(up[0].title).toBe('$NVDA is up 14%');
    expect(up[0].detail).toMatch(/\$200\.00 when I last told you, \$228\.00 now/);
    expect(up[0].detail).toMatch(/not a reason to buy/);
    const down = detectPriceMoves('NVDA', 200, price(170));
    expect(down[0].kind).toBe('price_down');
    expect(down[0].detail).toMatch(/Over three months it is -4\.0%/);
  });
  it('says when the symbol is no longer found, and has nothing to compare with when there was no price', () => {
    expect(detectPriceMoves('NVDA', 200, null)[0].kind).toBe('gone');
    expect(detectPriceMoves('NVDA', null, price(100))).toEqual([]);
  });
  it('never says buy, sell or safe', () => {
    const all = [...detectPriceMoves('X', 100, price(130)), ...detectPriceMoves('X', 100, price(70))].map((a) => a.title + a.detail).join(' ');
    expect(all).not.toMatch(/\b(sell|safe|guarantee)/i);
  });
});

describe('the talk', () => {
  it('more people, fewer people, or about the same', () => {
    expect(tractionChange('NVDA', { authors: 4, posts: 5 }, { authors: 15, posts: 20 })?.kind).toBe('talk_up');
    expect(tractionChange('NVDA', { authors: 14, posts: 20 }, { authors: 5, posts: 6 })?.kind).toBe('talk_down');
    expect(tractionChange('NVDA', { authors: 8, posts: 9 }, { authors: 9, posts: 11 })).toBeNull();
    expect(tractionChange('NVDA', { authors: 1, posts: 1 }, { authors: 3, posts: 3 })).toBeNull();
  });
  it('compares with when they added it', () => {
    expect(talkSince({ authors: 4, posts: 5 }, { authors: 15, posts: 20 })).toBe('15 people talking, up from 4 when you added it');
    expect(talkSince({ authors: 10, posts: 12 }, { authors: 9, posts: 12 })).toBe('about the same number of people talking (9)');
    expect(talkSince({ authors: 10, posts: 12 }, null)).toMatch(/costs a few cents through Buy/);
    expect(talkSince({ authors: 0, posts: 0 }, { authors: 0, posts: 0 })).toBe('hardly anyone is talking about it');
  });
  it('compares the price with when they added it', () => {
    expect(priceSince(200, 230)).toBe('price up 15.0% ($200.00 → $230.00)');
    expect(priceSince(200, 200.2)).toBe('price unchanged at $200.20');
    expect(priceSince(null, 50)).toBe('now $50.00');
    expect(priceSince(100, null)).toBe('no price right now');
  });
});

describe('not repeating itself', () => {
  it('drops a kind already sent inside the cooldown', () => {
    const NOW = new Date('2026-10-21T12:00:00Z');
    const a = detectPriceMoves('NVDA', 200, price(228));
    expect(withoutRecent(a, [{ kind: 'price_up', at: new Date(NOW.getTime() - 3600_000) }], NOW)).toEqual([]);
    expect(withoutRecent(a, [{ kind: 'price_up', at: new Date(NOW.getTime() - ALERT_COOLDOWN_MS - 1) }], NOW)).toHaveLength(1);
  });
});
