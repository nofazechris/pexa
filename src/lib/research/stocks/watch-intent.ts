import { extractSymbols } from './tickers';

/**
 * Reading "watch $NVDA", "keep an eye on Tesla stock TSLA", "stop watching $AMD" and "refresh the talk about $NVDA" without leaving
 * it to the model. A stock is named by a cashtag, or by an upper-case symbol next to the word "stock"/"shares"; anything about a pool,
 * yield or a coin is NOT a stock watch. Watching moves no money. Pure.
 */

export type TickerIntent = { kind: 'watch_ticker'; symbol: string } | { kind: 'unwatch_ticker'; symbol: string } | { kind: 'refresh_ticker'; symbol: string } | null;

const POOLISH = /\b(pool|pools|yield|apy|apr|staking|lending|aave|moola|uniswap|mento|compound|morpho|curve|usdt|usdc|usat|cusd|vault|celo)\b/i;
const WATCH = /\b(watch|keep an eye on|track|monitor)\b|\b(?:add|put|save)\b[^.]*\bwatch ?list\b/i;
const STOP = /\b(stop watching|unwatch|stop tracking|stop monitoring)\b|\bremove\b[^.]*\bwatch ?list\b/i;
const REFRESH = /\b(refresh|update|re-?check|check again)\b[^.]*\b(talk|buzz|chatter|traction|what people (?:are )?say(?:ing)?|conversation|hype)\b|\b(talk|buzz|chatter|traction)\b[^.]*\b(refresh|again|now)\b/i;
const STOCKISH = /\b(stocks?|shares?|ticker|equity)\b/i;

/** The one stock a message is about: a cashtag, or an UPPER-CASE symbol beside a stock word. */
function symbolOf(text: string): string | null {
  const cash = extractSymbols(text.replace(/\b([A-Z]{2,5})\b/g, (m) => m)).filter(() => /\$[A-Za-z]/.test(text));
  if (cash.length === 1) return cash[0];
  if (cash.length > 1) return null;
  if (!STOCKISH.test(text)) return null;
  const caps = [...text.matchAll(/(?<![A-Za-z$])([A-Z]{2,5})(?![A-Za-z])/g)].map((m) => m[1]).filter((s) => extractSymbols('$' + s).length === 1);
  return caps.length === 1 ? caps[0] : null;
}

export function parseTickerIntent(text: string): TickerIntent {
  const t = text.trim();
  if (!t || t.length > 220 || POOLISH.test(t)) return null;
  const symbol = symbolOf(t);
  if (!symbol) return null;
  if (REFRESH.test(t)) return { kind: 'refresh_ticker', symbol };
  if (STOP.test(t)) return { kind: 'unwatch_ticker', symbol };
  if (WATCH.test(t)) return { kind: 'watch_ticker', symbol };
  return null;
}
