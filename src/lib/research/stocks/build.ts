import { xTweets } from '../read';
import { collectMentions, type Post } from './tickers';
import { heatOf, rankHeat, type Heat } from './heat';
import { redditPosts } from './reddit';
import { assessStock } from './assess';
import type { PriceStats } from './prices';
import type { InvestorProfile } from '@/lib/profile/investor';
import type { StockItem, StockResearch } from '../types';

/**
 * The stock research, step by step: which searches to buy (X and Reddit, through Buy), how to turn what came back into ranked
 * tickers, and how to join them with real prices into the card the person sees. Pure except for where the prices come from.
 */

export const STOCK_SERVICE = { xSearch: 'x.posts.search', redditSearch: 'reddit.posts.search' } as const;

export interface StockQuery {
  role: 'sx1' | 'sx2' | 'sr1' | 'sr2';
  capabilityId: string;
  input: Record<string, unknown>;
  label: string;
}

/** "$NVDA" → "NVDA": the one stock a research is about (a refresh of the talk), or null for open-ended discovery. */
export function focusOf(what: string): string | null {
  const m = what.trim().match(/^\$([A-Za-z]{1,5})$/);
  return m ? m[1].toUpperCase() : null;
}

/** The four searches: two on X (the most-liked posts, and the newest), two on Reddit (what's hot, and the best-argued write-ups). */
export function stockQueries(theme: string): StockQuery[] {
  const focus = focusOf(theme);
  if (focus) {
    // One stock: what people said about it in the last few days, on X (most-liked, then newest) and on Reddit.
    return [
      { role: 'sx1', capabilityId: STOCK_SERVICE.xSearch, input: { query: `$${focus} min_faves:5 within_time:3d lang:en`, type: 'top' }, label: `Searching X for the most-liked posts about $${focus}` },
      { role: 'sx2', capabilityId: STOCK_SERVICE.xSearch, input: { query: `$${focus} within_time:2d lang:en`, type: 'latest' }, label: `Searching X for the newest posts about $${focus}` },
      { role: 'sr1', capabilityId: STOCK_SERVICE.redditSearch, input: { query: `${focus} stock`, type: 'post', sort: 'hot', timeRange: 'week' }, label: `Searching Reddit for $${focus}` },
    ];
  }
  const t = theme.replace(/\bstocks?\b/gi, '').replace(/[()"]/g, ' ').replace(/\s+/g, ' ').trim();
  const q = (s: string) => `${s}${t ? ` ${t}` : ''}`.slice(0, 500);
  return [
    { role: 'sx1', capabilityId: STOCK_SERVICE.xSearch, input: { query: q('("stocks to buy" OR "stocks to watch" OR bullish OR "price target" OR earnings) min_faves:50 within_time:3d lang:en'), type: 'top' }, label: 'Searching X for the stocks people are talking about' },
    { role: 'sx2', capabilityId: STOCK_SERVICE.xSearch, input: { query: q('(calls OR breakout OR rally OR "going up") min_faves:30 within_time:2d lang:en'), type: 'latest' }, label: 'Searching X for the newest stock talk' },
    { role: 'sr1', capabilityId: STOCK_SERVICE.redditSearch, input: { query: q('stocks'), type: 'post', sort: 'hot', timeRange: 'week' }, label: 'Searching Reddit for what’s hot in stocks' },
    { role: 'sr2', capabilityId: STOCK_SERVICE.redditSearch, input: { query: q('stock DD OR "why I bought"'), type: 'post', sort: 'top', timeRange: 'week' }, label: 'Searching Reddit for the best-argued write-ups' },
  ];
}

interface Step {
  role: string;
  outcome: string;
  output?: unknown;
}

/** Every post that came back, from both platforms. */
export function postsFromSteps(steps: readonly Step[]): { posts: Post[]; x: number; reddit: number } {
  const xs: Post[] = [];
  const rs: Post[] = [];
  for (const s of steps) {
    if (s.outcome !== 'PAID' || s.output === undefined) continue;
    if (s.role === 'sx1' || s.role === 'sx2') {
      for (const t of xTweets(s.output as never)) xs.push({ platform: 'x', id: t.id || `${t.author}:${t.text.slice(0, 20)}`, author: t.author, text: t.text, engagement: (t.likes ?? 0) + 2 * (t.replies ?? 0), at: t.at, followers: t.followers });
    } else if (s.role === 'sr1' || s.role === 'sr2') {
      rs.push(...redditPosts(s.output as never));
    }
  }
  // The same post can turn up in both X searches (or both Reddit ones): count it once.
  const dedupe = (list: Post[]) => [...new Map(list.map((p) => [`${p.platform}:${p.id}`, p])).values()];
  const x = dedupe(xs);
  const reddit = dedupe(rs);
  return { posts: [...x, ...reddit], x: x.length, reddit: reddit.length };
}

/** The tickers with the most real attention, before any price is looked up. */
export function candidatesFrom(steps: readonly Step[], now: Date, focus: string | null = null): { candidates: Heat[]; read: { x: number; reddit: number } } {
  const { posts, x, reddit } = postsFromSteps(steps);
  const mentions = collectMentions(posts);
  // For one stock the answer is that stock's own attention, even when it is very little (that is the finding).
  if (focus) return { candidates: [heatOf(focus, mentions.get(focus) ?? [], now)], read: { x, reddit } };
  return { candidates: rankHeat(mentions, now).slice(0, 12), read: { x, reddit } };
}

export type PriceLookup = { status: 'ok'; stats: PriceStats } | { status: 'unknown' } | { status: 'error' };

const MAX_SHOWN = 6;

/**
 * Join the attention with the prices. A symbol the price source doesn't know is dropped and named (likely not a real listing, or
 * not a stock). If prices can't be fetched at all the stocks are still shown, saying so. Ordered by attention, adjusted a little
 * for whether the price agrees (talk with a falling price, or after a huge run, drops down).
 */
export function buildStockItems(candidates: readonly Heat[], prices: ReadonlyMap<string, PriceLookup>, profile: InvestorProfile | null): { items: StockItem[]; unverified: string[] } {
  const unverified: string[] = [];
  const rows: { item: StockItem; rank: number }[] = [];
  for (const h of candidates) {
    const lookup = prices.get(h.symbol) ?? { status: 'error' as const };
    if (lookup.status === 'unknown') {
      unverified.push(h.symbol);
      continue;
    }
    const price = lookup.status === 'ok' ? lookup.stats : null;
    const a = assessStock(h, price, profile);
    let rank = h.score;
    if (a.pattern === 'attention and momentum') rank += 1;
    if (a.pattern === 'attention without price follow-through' || a.pattern === 'already ran hard') rank -= 1.5;
    if (a.pattern === 'looks coordinated') rank -= 3;
    rows.push({
      rank,
      item: {
        symbol: h.symbol,
        name: price?.name ?? null,
        pattern: a.pattern,
        heat: { posts: h.posts, authors: h.authors, engagement: h.engagement, platforms: h.platforms, newestDays: h.newestDays, score: h.score },
        price: price && { last: price.last, currency: price.currency, ret1w: price.ret1w, ret1m: price.ret1m, ret3m: price.ret3m, retYtd: price.retYtd, ret1y: price.ret1y, vol: price.vol, drawdown3m: price.drawdown3m, exchange: price.exchange },
        flags: a.flags,
        fit: a.fit,
        examples: h.examples,
      },
    });
  }
  rows.sort((a, b) => b.rank - a.rank);
  return { items: rows.slice(0, MAX_SHOWN).map((r) => r.item), unverified };
}

export type { StockResearch };
