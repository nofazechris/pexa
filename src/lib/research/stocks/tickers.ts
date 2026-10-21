/**
 * Finding stock tickers in what people post. A cashtag ($NVDA) is the strong signal; a bare capitalised word is only counted when it
 * sits next to words that make it a ticker ("NVDA calls", "bought AAPL"). Coins, common words and posts that are just a list of
 * tickers are filtered out, because they are noise or promotion. Pure.
 */

export interface Post {
  platform: 'x' | 'reddit';
  id: string;
  author: string;
  text: string;
  /** Likes + replies on X; score + comments on Reddit. */
  engagement: number;
  at: Date | null;
  /** The poster's follower count, when the platform says (X). */
  followers: number | null;
}

/** Coins that use cashtags too: not stocks. */
const COINS = new Set(['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ADA', 'BNB', 'USDT', 'USDC', 'SHIB', 'PEPE', 'AVAX', 'DOT', 'LINK', 'MATIC', 'LTC', 'TRX', 'CELO', 'TON', 'ARB', 'OP', 'SUI', 'APT', 'NEAR', 'ATOM', 'XLM', 'BCH', 'WIF', 'BONK', 'FLOKI', 'DAI']);
/** Capitalised words that are not tickers. */
const WORDS = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CEO', 'CFO', 'COO', 'IPO', 'ETF', 'DD', 'YOLO', 'ATH', 'EPS', 'PE', 'USA', 'GDP', 'FED', 'SEC', 'IRS', 'FOMO', 'HODL', 'OTC', 'ALL', 'FOR', 'ARE', 'THE', 'AND', 'NOT', 'BUY', 'SELL', 'HOLD', 'NEW', 'NOW', 'CAN', 'YOU', 'HAS', 'WAS', 'ITS', 'OUT', 'WSB', 'IMO', 'LOL', 'TLDR', 'EDIT', 'FYI', 'NYSE', 'ROI', 'API', 'CPI', 'PPI', 'FOMC', 'IRA', 'ROTH', 'LLC', 'INC', 'LTD', 'AI', 'EV', 'US', 'UK', 'EU', 'PM', 'AM', 'Q1', 'Q2', 'Q3', 'Q4', 'TO', 'IT', 'IS', 'IN', 'ON', 'OF', 'OR', 'AT', 'BE', 'DO', 'GO', 'IF', 'ME', 'MY', 'NO', 'SO', 'UP', 'WE', 'AN', 'AS', 'BY', 'HE', 'HI', 'OK', 'RIP', 'TBH', 'AMA', 'PSA', 'NSFW',
]);

const CASHTAG = /(?<![A-Za-z0-9$])\$([A-Za-z]{1,5})(?![A-Za-z0-9])/g;
const CONTEXT_AFTER = /\b([A-Z]{2,5})\s+(?:calls?|puts?|stock|shares?|earnings|options?|price|chart|squeeze)\b/g;
const CONTEXT_BEFORE = /\b(?:calls? on|puts? on|bought|buying|long|short|shares? of|stock in|invested in)\s+([A-Z]{2,5})\b/g;

/** Posts that name this many different tickers are lists or promotion, not a view on any one. */
export const MAX_TICKERS_PER_POST = 5;

/** The distinct stock tickers a post is about. Empty for a post that names too many (a list), or none. */
export function extractSymbols(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(CASHTAG)) found.add(m[1].toUpperCase());
  for (const m of text.matchAll(CONTEXT_AFTER)) found.add(m[1]);
  for (const m of text.matchAll(CONTEXT_BEFORE)) found.add(m[1]);
  const kept = [...found].filter((s) => !COINS.has(s) && !WORDS.has(s) && s.length >= 1 && s.length <= 5);
  return kept.length > MAX_TICKERS_PER_POST ? [] : kept;
}

/** The same message pasted by many accounts looks the same once links, case and spacing are removed. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/@\w+/g, '')
    .replace(/[^a-z0-9$ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every ticker mentioned, with the posts that mention it. */
export function collectMentions(posts: readonly Post[]): Map<string, Post[]> {
  const out = new Map<string, Post[]>();
  for (const p of posts) {
    for (const s of extractSymbols(p.text)) {
      const list = out.get(s) ?? [];
      list.push(p);
      out.set(s, list);
    }
  }
  return out;
}
