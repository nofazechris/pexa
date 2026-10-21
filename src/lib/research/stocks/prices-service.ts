import 'server-only';
import { parsePrices } from './prices';
import type { PriceLookup } from './build';

/**
 * Looks up a stock's price history from Yahoo Finance's public chart data (no key, unofficial: it can change or limit us, so every
 * failure is soft and nothing here is ever shown as a price unless it really came back). A symbol Yahoo says it doesn't know is
 * "unknown" (probably not a real listing); a network failure is "error" (the stock stays, without a price). Kept 15 minutes.
 */

const TTL_MS = 15 * 60_000;
const cache = new Map<string, { at: number; lookup: PriceLookup }>();

export async function lookupPrice(symbol: string, now = new Date()): Promise<PriceLookup> {
  const sym = symbol.toUpperCase();
  if (!/^[A-Z]{1,5}$/.test(sym)) return { status: 'unknown' };
  const hit = cache.get(sym);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.lookup;
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d`, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; pexa-research/0.1)', accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) {
      const lookup: PriceLookup = { status: 'unknown' };
      cache.set(sym, { at: Date.now(), lookup });
      return lookup;
    }
    if (!res.ok) return { status: 'error' };
    const stats = parsePrices(await res.json(), sym, now);
    const lookup: PriceLookup = stats ? { status: 'ok', stats } : { status: 'unknown' };
    cache.set(sym, { at: Date.now(), lookup });
    return lookup;
  } catch {
    return { status: 'error' };
  }
}

/** Prices for several symbols, a few at a time. */
export async function lookupPrices(symbols: readonly string[]): Promise<Map<string, PriceLookup>> {
  const out = new Map<string, PriceLookup>();
  const queue = [...new Set(symbols)];
  const worker = async () => {
    for (let s = queue.shift(); s !== undefined; s = queue.shift()) out.set(s, await lookupPrice(s));
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  return out;
}
