import type { PriceStats } from './prices';
import { ALERT_COOLDOWN_MS, withoutRecent } from '@/lib/yield/watch';

/**
 * Watching a stock: say, in plain words, when the price has moved a lot since we last told the person, and — when they refresh the
 * talk (which costs a few cents through Buy, so it is their tap) — whether more or fewer people are talking about it. Facts from
 * prices and posts only; nothing is predicted or recommended. Pure.
 */

export type TickerAlertKind = 'price_up' | 'price_down' | 'gone' | 'talk_up' | 'talk_down';

export interface TickerAlert {
  kind: TickerAlertKind;
  title: string;
  detail: string;
}

export { ALERT_COOLDOWN_MS, withoutRecent };
export const MAX_TICKER_WATCHES = 20;
/** A move of this much since the last alert is worth a message. */
export const PRICE_MOVE_PCT = 10;

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Price alerts, measured against the last price the person was told about. `now` null means the symbol is no longer found. */
export function detectPriceMoves(symbol: string, ref: number | null, now: PriceStats | null): TickerAlert[] {
  if (now === null) return [{ kind: 'gone', title: `$${symbol} is no longer found`, detail: 'The price source stopped listing this symbol. It may have been delisted or renamed; check before relying on it.' }];
  if (ref === null || ref <= 0) return [];
  const change = (now.last / ref - 1) * 100;
  if (change >= PRICE_MOVE_PCT) return [{ kind: 'price_up', title: `$${symbol} is up ${change.toFixed(0)}%`, detail: `${money(ref)} when I last told you, ${money(now.last)} now. A stock that has run up can fall back; this is a fact about the price, not a reason to buy.` }];
  if (change <= -PRICE_MOVE_PCT) return [{ kind: 'price_down', title: `$${symbol} is down ${Math.abs(change).toFixed(0)}%`, detail: `${money(ref)} when I last told you, ${money(now.last)} now.${now.ret3m !== null ? ` Over three months it is ${now.ret3m > 0 ? '+' : ''}${now.ret3m.toFixed(1)}%.` : ''}` }];
  return [];
}

export interface Traction {
  authors: number;
  posts: number;
}

/** How the talk compares with last time: more people talking, fewer, or about the same. */
export function tractionChange(symbol: string, last: Traction, now: Traction): TickerAlert | null {
  if (now.authors >= last.authors * 2 && now.authors >= last.authors + 3) {
    return { kind: 'talk_up', title: `More people are talking about $${symbol}`, detail: `${now.authors} different people posted about it, up from ${last.authors} last time. More talk is not the same as a better stock.` };
  }
  if (last.authors >= 6 && now.authors * 2 <= last.authors) {
    return { kind: 'talk_down', title: `The talk about $${symbol} is fading`, detail: `${now.authors} different people posted about it, down from ${last.authors} last time.` };
  }
  return null;
}

/** One plain sentence on the talk: now against when they added it. */
export function talkSince(baseline: Traction, now: Traction | null): string {
  if (now === null) return 'I haven’t refreshed the talk yet (that costs a few cents through Buy, so it is your tap)';
  const d = now.authors - baseline.authors;
  if (baseline.authors === 0 && now.authors === 0) return 'hardly anyone is talking about it';
  if (Math.abs(d) <= 1) return `about the same number of people talking (${now.authors})`;
  return `${now.authors} people talking, ${d > 0 ? 'up' : 'down'} from ${baseline.authors} when you added it`;
}

/** "since you added it" for the price. */
export function priceSince(baseline: number | null, now: number | null): string {
  if (now === null) return 'no price right now';
  if (baseline === null || baseline <= 0) return `now ${money(now)}`;
  const c = (now / baseline - 1) * 100;
  return Math.abs(c) < 0.5 ? `price unchanged at ${money(now)}` : `price ${c > 0 ? 'up' : 'down'} ${Math.abs(c).toFixed(1)}% (${money(baseline)} → ${money(now)})`;
}
