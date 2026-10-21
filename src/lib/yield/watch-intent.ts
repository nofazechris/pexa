/**
 * Reading "watch the Aave USDT pool on Celo and tell me when it hits 3%", "stop watching the Moola cUSD pool" and "show my
 * watchlist" without leaving it to the model. Watching moves no money; it only saves a pool and tells the person later.
 *
 * Pure.
 */

import { parseTickerIntent } from '@/lib/research/stocks/watch-intent';

export type WatchIntent =
  | { kind: 'none' }
  | { kind: 'watch_ticker'; symbol: string }
  | { kind: 'unwatch_ticker'; symbol: string }
  | { kind: 'refresh_ticker'; symbol: string }
  | { kind: 'watch_tickers'; symbols: string[] }
  | { kind: 'show' }
  | { kind: 'watch'; chain: string; project?: string; symbol: string; targetApy?: number; chainAssumed: boolean }
  | { kind: 'unwatch'; chain?: string; project?: string; symbol?: string };

const CHAINS: Record<string, string> = {
  celo: 'Celo', ethereum: 'Ethereum', mainnet: 'Ethereum', base: 'Base', arbitrum: 'Arbitrum', optimism: 'Optimism', polygon: 'Polygon', avalanche: 'Avalanche',
  bsc: 'BSC', bnb: 'BSC', binance: 'BSC', solana: 'Solana', scroll: 'Scroll', linea: 'Linea', mantle: 'Mantle', gnosis: 'Gnosis',
};
const PROJECTS = ['aave', 'moola', 'uniswap', 'mento', 'compound', 'morpho', 'curve', 'aerodrome', 'lido', 'spark', 'fluid', 'euler'];
const SYMBOLS = ['usdt', 'usdc', 'usat', 'cusd', 'ceur', 'eurc', 'dai', 'weth', 'eth', 'wbtc', 'btc', 'celo', 'usds', 'pyusd', 'tether'];

const POOL_WORDS = /\b(pool|pools|yield|apy|staking|lending|market|vault|rate)\b/i;
const WATCH_VERBS = /\b(watch|keep an eye on|track|monitor)\b/i;
const WATCHLIST_ADD = /\b(?:add|put|save)\b[^.]*\bwatch ?list\b/i;
const STOP = /\b(stop watching|unwatch|stop tracking|stop monitoring|remove\b[^.]*\bwatch ?list|take\b[^.]*\boff\b[^.]*\bwatch ?list)\b/i;
const SHOW = /\b(?:my|the|show(?: me)?(?: my)?|view|open|see)\s+watch ?list\b|\bwhat (?:am i|pools am i) (?:watching|tracking)\b|\bwhat(?:'s| is) on my watch ?list\b/i;
const TARGET = /\b(?:hits?|reach(?:es)?|above|over|gets? (?:to|above)|goes? (?:to|above|over)|at least)\s*(\d+(?:\.\d+)?)\s*%/i;

function find(text: string): { chain?: string; project?: string; symbol?: string } {
  const lower = text.toLowerCase().replace(/₮/g, 't');
  const words = new Set(lower.match(/[a-z0-9]+/g) ?? []);
  const chainKey = Object.keys(CHAINS).find((c) => words.has(c));
  const project = PROJECTS.find((p) => words.has(p));
  let symbol = SYMBOLS.find((s) => words.has(s));
  // "celo" is both a chain and a coin: it is the coin only when nothing else names a pool and the chain was said elsewhere.
  if (symbol === 'celo' && !(lower.match(/\bcelo\b/g) ?? []).length) symbol = undefined;
  if (symbol === 'tether') symbol = 'usdt';
  return { chain: chainKey ? CHAINS[chainKey] : undefined, project, symbol };
}

export function parseWatchIntent(text: string): WatchIntent {
  const t = text.trim();
  if (!t || t.length > 220) return { kind: 'none' };

  // A stock (a cashtag, or a symbol beside "stock") is watched in its own way.
  const stock = parseTickerIntent(t);
  if (stock) return stock;

  if (STOP.test(t)) {
    const f = find(t);
    return { kind: 'unwatch', chain: f.chain, project: f.project, symbol: f.symbol === 'celo' && f.chain === 'Celo' ? undefined : f.symbol };
  }
  const adding = WATCH_VERBS.test(t) || WATCHLIST_ADD.test(t);
  if (!adding) return SHOW.test(t) ? { kind: 'show' } : { kind: 'none' };

  const f = find(t);
  // Something about a pool: a coin or a project, and either a pool word or a project name. ("track my order" is not a pool.)
  const coin = f.symbol && !(f.symbol === 'celo' && f.chain === 'Celo' && !f.project) ? f.symbol : undefined;
  if (!coin && !f.project) return SHOW.test(t) ? { kind: 'show' } : { kind: 'none' };
  if (!POOL_WORDS.test(t) && !f.project) return { kind: 'none' };
  if (!coin) return { kind: 'none' };

  const target = t.match(TARGET);
  return { kind: 'watch', chain: f.chain ?? 'Celo', project: f.project, symbol: coin, ...(target ? { targetApy: Number(target[1]) } : {}), chainAssumed: !f.chain };
}
