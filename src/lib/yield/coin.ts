/**
 * Which coin the person actually named. When someone says "where can I earn on my USDC?" the answer has to be about USDC —
 * not whatever pool happens to rank first — so the app reads the coin out of their words and doesn't leave it to the model to
 * remember. If they name two coins, or none, nothing is assumed. Pure.
 */

export type NamedCoin = 'USDC' | 'USDT' | 'USAT' | 'CUSD' | 'DAI' | 'ETH';

const ALIASES: Record<string, NamedCoin> = { usdc: 'USDC', usdt: 'USDT', tether: 'USDT', usat: 'USAT', cusd: 'CUSD', dai: 'DAI', eth: 'ETH', ether: 'ETH' };

/** The coins mentioned, in order, without repeats. */
export function coinsNamed(text: string): NamedCoin[] {
  const out: NamedCoin[] = [];
  for (const m of text.toLowerCase().replace(/₮/g, 't').matchAll(/\b(usdc|usdt|tether|usat|cusd|dai|ether|eth)\b/g)) {
    const c = ALIASES[m[1]];
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** The one coin the person named, or null when they named none or several. "Celo" is a chain here, never counted as a coin. */
export function coinNamed(text: string): NamedCoin | null {
  const coins = coinsNamed(text);
  if (coins.length !== 1) return null;
  return coins[0];
}
