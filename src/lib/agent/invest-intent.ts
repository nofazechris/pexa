/**
 * Telling apart what a person wants when they talk about investing: researching which stocks are hot, researching where money can
 * earn (pools, staking, yield), or asking Pexa to buy a stock (which it can't do — there are no stocks on Celo and Pexa is not a
 * broker). The app reads this itself so that "get to know you first", the research flow and the honest "I can't buy that" don't
 * depend on a small model's mood. Pure.
 */

export type InvestIntent =
  | { kind: 'none' }
  | { kind: 'stocks'; theme: string | null }
  | { kind: 'trade' }
  | { kind: 'yield' };

const STOCK_WORDS = /\b(stocks?|shares|equit(?:y|ies)|tickers?|nasdaq|nyse|s&p|etfs?|penny stocks?|blue chips?)\b/i;
const RESEARCH_WORDS = /\b(viral|trending|hot|buzz(?:ing)?|popping|performing|doing well|going up|momentum|winners?|best|top|research|find|show|what|which|recommend|suggest|good|looking for|worth|opportunit)/i;
const TRADE_WORDS = /\b(buy|sell|purchase|trade|short|place an order|order)\b[^.?!]*(?:\$\s?\d|\b\d+\s*(?:dollars?|usd|shares?)\b|\bfor me\b|\bme\b|\bshares? of\b)|\b(?:buy|sell)\s+(?:me\s+)?(?:\$\d|\d)/i;
const YIELD_WORDS = /\b(earn|earning|yield|yields|apy|apr|staking|stake|interest|lend(?:ing)?|passive income|put my money|grow my (?:money|usdt|usdc|savings)|where can i (?:earn|put|invest)|invest(?:ing)?)\b/i;
/** "What does APY mean?" is a definition; "where should I put my money" is a request to research. */
const ACTIONABLE = /\b(where|best|top|which|invest|earn|put|stake|should i|can i|how can i|how do i|grow|looking)\b/i;
/** Words that mean the person is doing something with a pool, not asking where to put money. */
const ACTION_WORDS = /\b(deposit|withdraw|watch|watchlist|unwatch|track|convert|swap|send|pay|receive|bridge)\b/i;

const THEMES: [RegExp, string][] = [
  [/\bai\b|artificial intelligence/i, 'AI'],
  [/\bsemiconductors?|chips?\b/i, 'semiconductor'],
  [/\btech(?:nology)?\b/i, 'tech'],
  [/\bdividends?\b/i, 'dividend'],
  [/\bpenny\b/i, 'penny'],
  [/\bev\b|electric vehicles?/i, 'electric vehicle'],
  [/\bbiotech|pharma|health ?care\b/i, 'biotech'],
  [/\benergy|oil|solar\b/i, 'energy'],
  [/\bbanks?|financials?\b/i, 'bank'],
  [/\bcrypto(?:currency)? (?:related|stocks?)|bitcoin miners?\b/i, 'crypto-related'],
];

export function parseInvestIntent(text: string): InvestIntent {
  const t = text.trim();
  if (!t || t.length > 300) return { kind: 'none' };
  const stocky = STOCK_WORDS.test(t);

  if (stocky && TRADE_WORDS.test(t)) return { kind: 'trade' };
  if (stocky && RESEARCH_WORDS.test(t)) {
    const theme = THEMES.find(([re]) => re.test(t))?.[1] ?? null;
    return { kind: 'stocks', theme };
  }
  if (!stocky && !ACTION_WORDS.test(t) && YIELD_WORDS.test(t) && ACTIONABLE.test(t) && !/\bwatch/i.test(t)) return { kind: 'yield' };
  return { kind: 'none' };
}

/** The words for the search, e.g. "AI stocks" or just "stocks". */
export function themeLabel(theme: string | null): string {
  return theme ? `${theme} stocks` : 'stocks';
}
