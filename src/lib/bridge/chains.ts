/**
 * Bringing money to Pexa from another network ("auto bridging").
 *
 * People hold USDC on Arbitrum, Base and friends. They send it to a deposit address and it arrives in their Pexa wallet
 * as USDC on Celo (Relay does the swap/bridge). This file is the pure part: which networks we support and how to read
 * "I have USDC on Arbitrum, how do I get it to Celo?" without guessing.
 */

export interface BridgeChain {
  key: string;
  label: string;
  chainId: number;
  /** Circle's native USDC on that network. */
  usdc: string;
  /** Words people use for it. */
  aliases: string[];
}

export const BRIDGE_CHAINS: BridgeChain[] = [
  { key: 'arbitrum', label: 'Arbitrum', chainId: 42161, usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', aliases: ['arbitrum', 'arbitrium', 'arbitum', 'arb'] },
  { key: 'base', label: 'Base', chainId: 8453, usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', aliases: ['base'] },
  { key: 'optimism', label: 'Optimism', chainId: 10, usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', aliases: ['optimism', 'op mainnet', 'op'] },
  { key: 'polygon', label: 'Polygon', chainId: 137, usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', aliases: ['polygon', 'matic'] },
  { key: 'ethereum', label: 'Ethereum', chainId: 1, usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', aliases: ['ethereum', 'eth mainnet'] },
];

export const CELO_USDC = '0xcebA9300f2b948710d2653dD7B07f33A8B32118C';
export const CELO_CHAIN_ID = 42220;

export function chainByKey(key: string): BridgeChain | undefined {
  return BRIDGE_CHAINS.find((c) => c.key === key);
}

export function chainById(id: number): BridgeChain | undefined {
  return BRIDGE_CHAINS.find((c) => c.chainId === id);
}

export function chainList(): string {
  return BRIDGE_CHAINS.map((c) => c.label).join(', ');
}

/** The question we ask when we need to know the network; the answer is recognised on the next turn. */
export const ASK_NETWORK_MARKER = 'Which network is your USDC on?';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ALIAS_RE = BRIDGE_CHAINS.flatMap((c) => c.aliases.map((a) => ({ chain: c, re: new RegExp(`(^|[^a-z])${escape(a)}($|[^a-z])`, 'i') })));
const UNSUPPORTED = /\b(solana|sol|bitcoin|btc|tron|trc20|bnb|bsc|binance|avalanche|avax|fantom|zksync|linea|scroll)\b/i;

/** Which supported network does this text name? (Longest, most specific alias wins.) */
export function findChain(text: string): BridgeChain | null {
  const hits = ALIAS_RE.filter((a) => a.re.test(text));
  if (!hits.length) return null;
  // "op" and "eth" style short words only count when nothing more specific is there.
  hits.sort((a, b) => b.re.source.length - a.re.source.length);
  return hits[0].chain;
}

export type BridgeIntent =
  | { kind: 'none' }
  /** They want to bring money from another network; `chain` is set when they named a supported one. */
  | { kind: 'bridge'; chain: BridgeChain | null }
  /** They named a network we can't do yet. */
  | { kind: 'unsupported'; name: string };

const BRIDGE_WORDS = /\b(bridge|bridging|cross[- ]?chain|another (chain|network|blockchain)|other (chain|network)|different (chain|network))\b/i;
const MOVE_WORDS = /\b(get|move|bring|transfer|receive|deposit|send|top[- ]?up|add|fund|swap|convert|withdraw|bridge)\b/i;
const TO_PEXA = /\b(celo|pexa|my wallet|my pexa|here)\b/i;
/** "send 5 to @joyful" and friends are payments, never bridges. */
const PAYMENT_TARGET = /(@\w|\bto\s+(@|\w+\s+(on|via)\b))/i;

/**
 * Is this person trying to bring money in from another network? Conservative: it needs either bridge words, or a named
 * network together with a "get it to Celo/my wallet" kind of sentence.
 */
export function parseBridgeIntent(text: string, askedForNetwork = false): BridgeIntent {
  const t = text.trim();
  if (!t || t.length > 220) return { kind: 'none' };

  const chain = findChain(t);

  // Answering "which network is your USDC on?" with just the network.
  if (askedForNetwork) {
    if (chain && t.split(/\s+/).length <= 6) return { kind: 'bridge', chain };
    const un = t.match(UNSUPPORTED);
    if (un && t.split(/\s+/).length <= 6) return { kind: 'unsupported', name: un[1] };
  }

  const hasBridgeWords = BRIDGE_WORDS.test(t);
  const unsupported = t.match(UNSUPPORTED);
  const mentionsUsdc = /\b(usdc|usdt|stablecoins?|dollars?|money|funds|crypto)\b/i.test(t);
  const fromNetwork = /\b(from|on|via|using)\b/i.test(t);
  const movesToPexa = MOVE_WORDS.test(t) && TO_PEXA.test(t);

  const looksLikeBridge = hasBridgeWords || (chain && mentionsUsdc && (movesToPexa || /\bhow (do|can|to)\b/i.test(t) || /\bi (have|hold|got)\b/i.test(t))) || (chain && fromNetwork && movesToPexa) || (chain && MOVE_WORDS.test(t) && /\bfrom\b/i.test(t));
  const looksLikeBridgeToUnsupported = hasBridgeWords || (unsupported && mentionsUsdc && (movesToPexa || /\bhow (do|can|to)\b/i.test(t) || /\bi (have|hold|got)\b/i.test(t))) || (unsupported && MOVE_WORDS.test(t) && /\bfrom\b/i.test(t));

  if (PAYMENT_TARGET.test(t) && !hasBridgeWords) return { kind: 'none' };

  if (unsupported && !chain && looksLikeBridgeToUnsupported) return { kind: 'unsupported', name: unsupported[1] };
  if (looksLikeBridge) return { kind: 'bridge', chain };
  return { kind: 'none' };
}
