import { describe, expect, it } from 'vitest';
import { ALLOWED_SERVICES, MAX_PURCHASES, RESEARCH_HARD_CAP_ATOMIC, assemble, capFor, decideNext, describePlan, freshForMs, SERVICE, type StepState } from '../engine';
import { normalizeRequest } from '../request';
import { STOCK_SERVICE, buildStockItems, stockQueries, type PriceLookup } from './build';
import { heatOf } from './heat';
import { parsePrices } from './prices';
import type { Post } from './tickers';
import type { ResearchRequest } from '../types';

const NOW = new Date('2026-10-21T12:00:00Z');
const REQ: ResearchRequest = { kind: 'stocks', platforms: ['x', 'reddit'], what: 'stocks', place: '' };
const step = (over: Partial<StepState>): StepState => ({ role: 'sx1', ref: null, outcome: 'PAID', priceAtomic: 5000n, ...over });

const tweet = (id: string, author: string, text: string, likes = 120, followers = 8000) => ({ tweet_id: id, screen_name: author, text, favorites: likes, replies: 5, created_at: 'Tue Oct 20 10:00:00 +0000 2026', user_info: { followers_count: followers } });
const xOut = (n: number, sym: string) => ({ timeline: Array.from({ length: n }, (_, i) => tweet(`${sym}${i}`, `trader${i}`, `$${sym} earnings look strong, take number ${i}`)) });
const redditOut = (sym: string) => ({ data: { posts: [{ id: 'r1', title: `${sym} DD: why I am holding`, selftext: `Long thesis on $${sym}`, author: 'dd_guy', score: 3000, num_comments: 400, created_utc: Math.floor(NOW.getTime() / 1000) - 7200 }, { id: 'r2', title: `YOLO $${sym} calls`, author: 'ape_1', score: 900, num_comments: 80, created_utc: Math.floor(NOW.getTime() / 1000) - 3600 }] } });

describe('the stock research plan', () => {
  it('needs no place and no platform choice, and reads X and Reddit', () => {
    const n = normalizeRequest({ kind: 'stocks', what: 'AI stocks' });
    expect(n).toEqual({ ok: true, request: { kind: 'stocks', platforms: ['x', 'reddit'], what: 'AI stocks', place: '' } });
    expect(normalizeRequest({ kind: 'stocks' })).toMatchObject({ ok: true, request: { what: 'stocks' } });
  });
  it('costs a few cents, is capped well under the hard cap, and says nothing is bought or sold', () => {
    const p = describePlan(REQ);
    expect(p.estimate).toBe('$0.02');
    expect(capFor(REQ)).toBe(100_000n);
    expect(capFor(REQ) <= RESEARCH_HARD_CAP_ATOMIC).toBe(true);
    expect(p.steps.join(' ')).toMatch(/nothing is bought or sold/);
    expect(p.steps.join(' ')).toMatch(/real price history/);
  });
  it('only uses services on the allow-list', () => {
    for (const q of stockQueries('stocks')) expect(ALLOWED_SERVICES.has(q.capabilityId)).toBe(true);
    expect(ALLOWED_SERVICES.has(STOCK_SERVICE.redditSearch)).toBe(true);
    expect(SERVICE.redditSearch).toBe('reddit.posts.search');
    expect(freshForMs(SERVICE.redditSearch)).toBeGreaterThan(0);
  });
  it('turns a theme into the searches', () => {
    const qs = stockQueries('AI stocks');
    expect(qs.map((q) => q.role)).toEqual(['sx1', 'sx2', 'sr1', 'sr2']);
    expect(qs[0].input.query).toMatch(/ AI$/);
    expect(qs[0].input.type).toBe('top');
    expect(qs[2].input).toMatchObject({ type: 'post', sort: 'hot', timeRange: 'week' });
    for (const q of qs) expect(String(q.input.query).length).toBeLessThanOrEqual(512);
  });
});

describe('running it', () => {
  it('buys the four searches one at a time, then finishes', () => {
    const steps: StepState[] = [];
    const bought: string[] = [];
    for (let i = 0; i < 10; i++) {
      const n = decideNext(REQ, steps);
      if (n.action === 'finish') {
        expect(n.reason).toBe('done');
        break;
      }
      bought.push(n.role);
      steps.push(step({ role: n.role, output: n.role.startsWith('sx') ? xOut(4, 'NVDA') : redditOut('NVDA') }));
    }
    expect(bought).toEqual(['sx1', 'sx2', 'sr1', 'sr2']);
    expect(steps.length).toBeLessThanOrEqual(MAX_PURCHASES);
  });
  it('carries on past a search that failed, and stops cleanly when nothing came back', () => {
    expect(decideNext(REQ, [step({ role: 'sx1', outcome: 'FAILED', priceAtomic: 0n })])).toMatchObject({ action: 'buy', role: 'sx2' });
    const allFailed = ['sx1', 'sx2', 'sr1', 'sr2'].map((role) => step({ role: role as StepState['role'], outcome: 'FAILED', priceAtomic: 0n }));
    expect(decideNext(REQ, allFailed)).toEqual({ action: 'finish', reason: 'search_failed' });
  });
  it('says so when the answers are full but unreadable, rather than "found nothing"', () => {
    const steps = ['sx1', 'sx2', 'sr1', 'sr2'].map((role) => step({ role: role as StepState['role'], output: { weird: 'x'.repeat(400), items: [{ q: 1 }] } }));
    expect(decideNext(REQ, steps)).toEqual({ action: 'finish', reason: 'unreadable' });
  });
  it('assembles the tickers several different people are talking about, on both platforms', () => {
    const steps = [step({ role: 'sx1', output: xOut(6, 'NVDA') }), step({ role: 'sx2', output: xOut(3, 'AMD') }), step({ role: 'sr1', output: redditOut('NVDA') }), step({ role: 'sr2', output: { data: { posts: [] } } })];
    const r = assemble(REQ, steps, 'done', NOW);
    expect(r.stocks?.candidates[0].symbol).toBe('NVDA');
    expect(r.stocks?.candidates[0].platforms).toEqual(['x', 'reddit']);
    expect(r.stocks?.read).toEqual({ x: 9, reddit: 2 });
    expect(r.spent).toBe('$0.02');
    expect(r.items).toEqual([]);
    expect(r.summary).toMatch(/tickers that different people are talking about/);
  });
  it('reports honestly when nobody is talking about any one stock', () => {
    const r = assemble(REQ, [step({ role: 'sx1', output: xOut(1, 'ZZZ') })], 'done', NOW);
    expect(r.summary).toMatch(/couldn’t find a stock/);
  });
});

describe('joining the talk with real prices', () => {
  const posts = (sym: string, n: number): Post[] => Array.from({ length: n }, (_, i) => ({ platform: 'x', id: sym + i, author: `u${sym}${i}`, text: `$${sym} take ${i}`, engagement: 80, at: new Date(NOW.getTime() - 3_600_000), followers: 5000 }));
  const heats = [heatOf('NVDA', posts('NVDA', 8), NOW), heatOf('FAKE', posts('FAKE', 7), NOW), heatOf('HYPE', posts('HYPE', 6), NOW)];
  const chart = (daily: number) => {
    const t0 = Math.floor(NOW.getTime() / 1000) - 259 * 86_400;
    let p = 100;
    const ts: number[] = [];
    const close: number[] = [];
    for (let i = 0; i < 260; i++) {
      ts.push(t0 + i * 86_400);
      p *= 1 + daily / 100;
      close.push(p);
    }
    return { chart: { result: [{ meta: { currency: 'USD', longName: 'Test Co' }, timestamp: ts, indicators: { quote: [{ close }] } }] } };
  };
  const ok = (sym: string, daily: number): PriceLookup => ({ status: 'ok', stats: parsePrices(chart(daily), sym, NOW)! });

  it('drops a symbol the price source does not know, and names it', () => {
    const { items, unverified } = buildStockItems(heats, new Map<string, PriceLookup>([['NVDA', ok('NVDA', 0.2)], ['FAKE', { status: 'unknown' }], ['HYPE', ok('HYPE', 0.2)]]), null);
    expect(unverified).toEqual(['FAKE']);
    expect(items.map((i) => i.symbol)).not.toContain('FAKE');
  });
  it('keeps a stock when the price source could not be reached, honestly without a price', () => {
    const { items } = buildStockItems(heats.slice(0, 1), new Map<string, PriceLookup>([['NVDA', { status: 'error' }]]), null);
    expect(items[0].price).toBeNull();
    expect(items[0].flags.map((f) => f.text).join(' ')).toMatch(/couldn’t get price data/);
  });
  it('moves a stock down when it has already run hard, and up when the price agrees with the talk', () => {
    const prices = new Map<string, PriceLookup>([['NVDA', ok('NVDA', 0.25)], ['HYPE', ok('HYPE', 2.5)], ['FAKE', ok('FAKE', 0.2)]]);
    const { items } = buildStockItems([heats[2], heats[0]], prices, null);
    expect(items[0].symbol).toBe('NVDA');
    expect(items.find((i) => i.symbol === 'HYPE')?.pattern).toBe('already ran hard');
  });
  it('shows at most six', () => {
    const many = Array.from({ length: 10 }, (_, i) => heatOf('T' + String.fromCharCode(65 + i), posts('T' + String.fromCharCode(65 + i), 5), NOW));
    const prices = new Map<string, PriceLookup>(many.map((h) => [h.symbol, ok(h.symbol, 0.2)]));
    expect(buildStockItems(many, prices, null).items).toHaveLength(6);
  });
  it('adds the person’s profile line when they have one', () => {
    const { items } = buildStockItems(heats.slice(0, 1), new Map<string, PriceLookup>([['NVDA', ok('NVDA', 0.2)]]), { risk: 'cautious', horizon: 'long', amountUsd: 300, skipped: false });
    expect(items[0].fit).toMatch(/cautious|play it safe|size it small/i);
  });
});

import { focusOf } from './build';

describe('refreshing the talk about one stock', () => {
  const FOCUS: ResearchRequest = { kind: 'stocks', platforms: ['x', 'reddit'], what: '$NVDA', place: '' };
  it('knows a single stock from an open-ended research', () => {
    expect(focusOf('$NVDA')).toBe('NVDA');
    expect(focusOf('$nvda')).toBe('NVDA');
    expect(focusOf('AI stocks')).toBeNull();
    expect(focusOf('stocks')).toBeNull();
  });
  it('searches only for that stock: two on X and one on Reddit, a cent or two in all', () => {
    const qs = stockQueries('$NVDA');
    expect(qs.map((q) => q.role)).toEqual(['sx1', 'sx2', 'sr1']);
    expect(String(qs[0].input.query)).toContain('$NVDA');
    expect(qs[2].input).toMatchObject({ type: 'post', sort: 'hot', timeRange: 'week' });
    const p = describePlan(FOCUS);
    expect(p.title).toBe('Refresh the talk about $NVDA');
    expect(p.estimate).toBe('$0.015');
    expect(p.steps.join(' ')).toMatch(/compare with last time/);
  });
  it('buys the three and finishes', () => {
    const steps: StepState[] = [];
    const bought: string[] = [];
    for (let i = 0; i < 6; i++) {
      const n = decideNext(FOCUS, steps);
      if (n.action === 'finish') break;
      bought.push(n.role);
      steps.push(step({ role: n.role, output: n.role.startsWith('sx') ? xOut(4, 'NVDA') : redditOut('NVDA') }));
    }
    expect(bought).toEqual(['sx1', 'sx2', 'sr1']);
  });
  it('answers with that stock even when almost nobody is talking about it — that is the finding', () => {
    const r = assemble(FOCUS, [step({ role: 'sx1', output: xOut(1, 'NVDA') })], 'done', NOW);
    expect(r.stocks?.candidates).toHaveLength(1);
    expect(r.stocks?.candidates[0]).toMatchObject({ symbol: 'NVDA', authors: 1 });
    expect(r.summary).toMatch(/1 different people were talking about it|0 different people|1 different/);
  });
  it('with plenty of talk, counts the people', () => {
    const r = assemble(FOCUS, [step({ role: 'sx1', output: xOut(7, 'NVDA') }), step({ role: 'sr1', output: redditOut('NVDA') })], 'done', NOW);
    expect(r.stocks?.candidates[0].authors).toBe(9);
  });
});
