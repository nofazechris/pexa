import { describe, expect, it } from 'vitest';
import { collectMentions, extractSymbols, normalizeText, type Post } from './tickers';
import { heatOf, rankHeat } from './heat';
import { parsePrices } from './prices';
import { assessStock } from './assess';
import { redditPosts } from './reddit';
import { xTweets } from '../read';

const NOW = new Date('2026-10-21T12:00:00Z');
const day = 86_400_000;
const post = (over: Partial<Post>): Post => ({ platform: 'x', id: Math.random().toString(36).slice(2), author: 'someone', text: '$NVDA looks strong', engagement: 50, at: new Date(NOW.getTime() - 3_600_000), followers: 5_000, ...over });

describe('finding tickers', () => {
  it('reads cashtags and contextual tickers, ignoring coins and ordinary words', () => {
    expect(extractSymbols('Loading up on $NVDA and $amd today')).toEqual(['NVDA', 'AMD']);
    expect(extractSymbols('TSLA calls printing, bought AAPL last week')).toEqual(expect.arrayContaining(['TSLA', 'AAPL']));
    expect(extractSymbols('$BTC and $ETH to the moon, also $SOL')).toEqual([]);
    expect(extractSymbols('The CEO said the IPO is ON, BUY now')).toEqual([]);
    expect(extractSymbols('I paid $5 for lunch and $20 for a cab')).toEqual([]);
  });
  it('drops posts that are just a list of tickers (promotion)', () => {
    expect(extractSymbols('$AAPL $MSFT $GOOG $AMZN $META $NVDA $TSLA all green')).toEqual([]);
  });
  it('sees the same message through links and spacing', () => {
    expect(normalizeText('$NVDA is  HOT!! https://t.co/abc @pump')).toBe(normalizeText('$nvda is hot https://example.com'));
  });
  it('collects posts per ticker', () => {
    const m = collectMentions([post({ text: '$NVDA up' }), post({ text: '$NVDA and $AMD' }), post({ text: 'nothing here' })]);
    expect(m.get('NVDA')).toHaveLength(2);
    expect(m.get('AMD')).toHaveLength(1);
  });
});

describe('how much real attention', () => {
  const many = (n: number, over: (i: number) => Partial<Post> = () => ({})) => Array.from({ length: n }, (_, i) => post({ author: `user${i}`, text: `$NVDA take number ${i}: earnings look strong`, ...over(i) }));
  it('counts different people, not posts', () => {
    expect(heatOf('NVDA', many(6), NOW).authors).toBe(6);
    expect(heatOf('NVDA', Array.from({ length: 6 }, (_, i) => post({ author: 'same', text: `$NVDA different words ${i}` })), NOW).authors).toBe(1);
  });
  it('marks copy-pasted promotion and tiny accounts, and scores them down', () => {
    const honest = heatOf('NVDA', many(8), NOW);
    const pasted = heatOf('NVDA', Array.from({ length: 8 }, (_, i) => post({ author: `bot${i}`, text: '$NVDA is going to 500 buy now https://x.co/' + i })), NOW);
    expect(pasted.copyShare).toBeGreaterThan(0.4);
    expect(pasted.score).toBeLessThan(honest.score);
    const tiny = heatOf('NVDA', many(8, () => ({ followers: 50 })), NOW);
    expect(tiny.tinyShare).toBe(1);
    expect(tiny.score).toBeLessThan(honest.score);
  });
  it('rewards spreading across platforms and being fresh', () => {
    const one = heatOf('NVDA', many(5), NOW);
    const both = heatOf('NVDA', [...many(4), post({ platform: 'reddit', author: 'redditor', text: 'NVDA DD: why I am holding $NVDA' })], NOW);
    expect(both.platforms).toEqual(['x', 'reddit']);
    expect(both.score).toBeGreaterThan(one.score - 0.1);
    expect(heatOf('NVDA', many(5, () => ({ at: new Date(NOW.getTime() - 5 * day) })), NOW).score).toBeLessThan(one.score);
  });
  it('a ticker only one voice talks about is noise', () => {
    const m = collectMentions([post({ author: 'a', text: '$ZZZ will fly' }), ...many(4)]);
    expect(rankHeat(m, NOW).map((h) => h.symbol)).toEqual(['NVDA']);
  });
});

/** A small Yahoo-shaped chart: a steady climb of `daily`% a day over `n` days ending today. */
const chart = (n: number, daily: number, over: { shock?: number } = {}) => {
  const t0 = Math.floor(NOW.getTime() / 1000) - (n - 1) * 86_400;
  const ts: number[] = [];
  const close: number[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    ts.push(t0 + i * 86_400);
    p *= 1 + daily / 100 + (over.shock && i % 7 === 0 ? (i % 14 === 0 ? over.shock : -over.shock) / 100 : 0);
    close.push(p);
  }
  return { chart: { result: [{ meta: { currency: 'USD', symbol: 'NVDA', longName: 'NVIDIA Corporation', fullExchangeName: 'NasdaqGS' }, timestamp: ts, indicators: { quote: [{ close }] } }], error: null } };
};

describe('price facts', () => {
  it('works out the moves from closing prices', () => {
    const s = parsePrices(chart(260, 0.3), 'nvda', NOW)!;
    expect(s).toMatchObject({ symbol: 'NVDA', name: 'NVIDIA Corporation', currency: 'USD', exchange: 'NasdaqGS' });
    expect(s.ret1w!).toBeGreaterThan(1);
    expect(s.ret1m!).toBeGreaterThan(s.ret1w!);
    expect(s.ret3m!).toBeGreaterThan(s.ret1m!);
    expect(s.ret1y).not.toBeNull();
    expect(s.drawdown3m).toBe(0);
  });
  it('measures a bumpy ride', () => {
    const calm = parsePrices(chart(260, 0.05), 'X', NOW)!;
    const wild = parsePrices(chart(260, 0.05, { shock: 8 }), 'X', NOW)!;
    expect(wild.vol!).toBeGreaterThan(calm.vol! * 3);
    expect(wild.drawdown3m!).toBeGreaterThan(5);
  });
  it('is null for a symbol with no data', () => {
    expect(parsePrices({ chart: { result: null, error: { code: 'Not Found' } } }, 'ZZZZ', NOW)).toBeNull();
    expect(parsePrices(chart(3, 1), 'ZZ', NOW)).toBeNull();
  });
});

describe('what the evidence says, with nothing recommended', () => {
  const heat = (over: Partial<ReturnType<typeof heatOf>> = {}) => ({ ...heatOf('NVDA', Array.from({ length: 8 }, (_, i) => post({ author: `u${i}`, text: `$NVDA take ${i}` })), NOW), ...over });
  const price = (over: Partial<NonNullable<ReturnType<typeof parsePrices>>> = {}) => ({ ...parsePrices(chart(260, 0.2), 'NVDA', NOW)!, ...over });
  const texts = (a: ReturnType<typeof assessStock>) => a.flags.map((f) => f.text).join(' | ');

  it('attention that the price agrees with', () => {
    expect(assessStock(heat(), price({ ret1m: 12, vol: 30, last: 120 }), null).pattern).toBe('attention and momentum');
  });
  it('lots of talk but the price is falling', () => {
    const a = assessStock(heat(), price({ ret1m: -8 }), null);
    expect(a.pattern).toBe('attention without price follow-through');
    expect(texts(a)).toMatch(/down 8\.0% this month/);
  });
  it('a move that has already happened', () => {
    const a = assessStock(heat(), price({ ret1m: 55 }), null);
    expect(a.pattern).toBe('already ran hard');
    expect(texts(a)).toMatch(/Already up 55% this month/);
  });
  it('talk that looks promoted', () => {
    expect(assessStock(heat({ copyShare: 0.6 }), price(), null).pattern).toBe('looks coordinated');
  });
  it('says plainly when there is no price data', () => {
    expect(texts(assessStock(heat(), null, null))).toMatch(/couldn’t get price data/);
  });
  it('flags a bumpy, low-priced stock', () => {
    const t = texts(assessStock(heat(), price({ vol: 85, last: 2.4, drawdown3m: 40 }), null));
    expect(t).toMatch(/Very bumpy/);
    expect(t).toMatch(/Low-priced/);
    expect(t).toMatch(/fell as much as 40%/);
  });
  it('never says buy, sell, safe or recommended', () => {
    const all = [assessStock(heat(), price({ ret1m: 12 }), null), assessStock(heat(), price({ ret1m: 55 }), null), assessStock(heat(), null, null)].map((a) => a.pattern + texts(a)).join(' ');
    expect(all).not.toMatch(/\b(buy|sell|safe|recommend|guarantee)/i);
  });
  it('adds one line about how it sits with the person’s profile', () => {
    const cautious = { risk: 'cautious' as const, horizon: 'long' as const, amountUsd: 500, skipped: false };
    expect(assessStock(heat(), price({ vol: 70 }), cautious).fit).toMatch(/play it safe/);
    expect(assessStock(heat(), price({ vol: 20, last: 200, ret1m: 3 }), cautious).fit).toMatch(/size it small/);
    expect(assessStock(heat(), price({ vol: 70 }), { ...cautious, skipped: true }).fit).toBeNull();
    expect(assessStock(heat(), price(), null).fit).toBeNull();
  });
});

describe('reading posts from Buy', () => {
  it('reads X tweets with the existing reader and turns them into posts', () => {
    const tweets = xTweets({ timeline: [{ tweet_id: '1', screen_name: 'trader1', text: '$NVDA ripping', favorites: 120, replies: 10, created_at: 'Tue Oct 20 10:00:00 +0000 2026', user_info: { followers_count: 9000 } }] });
    expect(tweets).toHaveLength(1);
    expect(tweets[0]).toMatchObject({ author: 'trader1', likes: 120, followers: 9000 });
  });
  it('reads a Reddit reply in the usual shapes, and skips what it cannot read', () => {
    const usual = { data: { posts: [{ id: 'abc', title: 'NVDA DD: why I am all in', selftext: 'Long thesis about $NVDA', author: 'dd_guy', score: 4200, num_comments: 380, created_utc: 1792500000, subreddit: 'wallstreetbets' }, { id: 'x', title: 'Removed', author: '[deleted]', score: 1 }, { nothing: true }] } };
    const posts = redditPosts(usual);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ platform: 'reddit', author: 'dd_guy', engagement: 4580 });
    expect(posts[0].text).toMatch(/NVDA DD/);
    expect(posts[0].at?.getUTCFullYear()).toBe(2026);
    const other = { results: [{ post_title: 'YOLO $AMD', author: { name: 'ape' }, ups: '900', commentCount: 40, createdAt: '2026-10-20T10:00:00Z' }] };
    expect(redditPosts(other)[0]).toMatchObject({ author: 'ape', engagement: 940 });
    expect(redditPosts({ error: 'x' })).toEqual([]);
  });
});
