/**
 * Getting paid from another network ("auto bridging").
 *
 * Someone wants to send you USDC from Arbitrum, Base, Solana… You give them an address; what they send arrives in your
 * Pexa wallet as USDC on Celo (Relay does the swap/bridge). This file is the pure part: the networks we support and how
 * to read "somebody wants to send me USDC on Arbitrum" or "I have USDC on Arbitrum, how do I get it to Celo" without guessing.
 */

export interface BridgeChain {
  key: string;
  label: string;
  chainId: number;
  /** Ethereum-style addresses (0x…) or Solana's. */
  kind: 'evm' | 'svm';
  /** The network's native USDC: a contract address, or the mint on Solana. */
  usdc: string;
  /** Relay only hands out deposit addresses for this network to accounts with an API key. */
  needsApiKey: boolean;
  /** Words people use for it. */
  aliases: string[];
}

export const BRIDGE_CHAINS: BridgeChain[] = [
  { key: 'arbitrum', label: 'Arbitrum', chainId: 42161, kind: 'evm', needsApiKey: false, usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', aliases: ['arbitrum', 'arbitrium', 'arbitum', 'arb'] },
  { key: 'base', label: 'Base', chainId: 8453, kind: 'evm', needsApiKey: false, usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', aliases: ['base'] },
  { key: 'optimism', label: 'Optimism', chainId: 10, kind: 'evm', needsApiKey: false, usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', aliases: ['optimism', 'op mainnet', 'op'] },
  { key: 'polygon', label: 'Polygon', chainId: 137, kind: 'evm', needsApiKey: false, usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', aliases: ['polygon', 'matic'] },
  { key: 'ethereum', label: 'Ethereum', chainId: 1, kind: 'evm', needsApiKey: false, usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', aliases: ['ethereum', 'eth mainnet'] },
  { key: 'solana', label: 'Solana', chainId: 792703809, kind: 'svm', needsApiKey: true, usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', aliases: ['solana', 'sol'] },
];

export const CELO_USDC = '0xcebA9300f2b948710d2653dD7B07f33A8B32118C';
export const CELO_CHAIN_ID = 42220;

export function chainByKey(key: string): BridgeChain | undefined {
  return BRIDGE_CHAINS.find((c) => c.key === key);
}

export function chainById(id: number): BridgeChain | undefined {
  return BRIDGE_CHAINS.find((c) => c.chainId === id);
}

/** Networks that work right now: all of them with a Relay API key, otherwise the Ethereum-style ones. */
export function availableChains(hasApiKey: boolean): BridgeChain[] {
  return BRIDGE_CHAINS.filter((c) => !c.needsApiKey || hasApiKey);
}

export function chainList(hasApiKey: boolean): string {
  return availableChains(hasApiKey)
    .map((c) => c.label)
    .join(', ');
}

/** The question we ask when we need to know the network; the answer is recognised on the next turn. */
export const ASK_NETWORK_MARKER = 'Which network will the USDC come from?';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ALIAS_RE = BRIDGE_CHAINS.flatMap((c) => c.aliases.map((a) => ({ chain: c, re: new RegExp(`(^|[^a-z])${escape(a)}($|[^a-z])`, 'i') })));
const UNSUPPORTED = /\b(bitcoin|btc|tron|trc20|bnb|bsc|binance|avalanche|avax|fantom|zksync|linea|scroll|cardano|ton|xrp|ripple)\b/i;

/** Which supported network does this text name? (Longest, most specific alias wins.) */
export function findChain(text: string): BridgeChain | null {
  const hits = ALIAS_RE.filter((a) => a.re.test(text));
  if (!hits.length) return null;
  hits.sort((a, b) => b.re.source.length - a.re.source.length);
  return hits[0].chain;
}

export type BridgeIntent =
  | { kind: 'none' }
  /** Bring money from another network; `chain` is set when they named a supported one. */
  | { kind: 'bridge'; chain: BridgeChain | null }
  /** They named a network we can't do yet. */
  | { kind: 'unsupported'; name: string }
  /** The sender is already on Celo (or on Pexa): that's the normal wallet address, no bridge needed. */
  | { kind: 'celo' };

const BRIDGE_WORDS = /\b(bridge|bridging|cross[- ]?chain|another (chain|network|blockchain)|other (chain|network)|different (chain|network))\b/i;
const MOVE_WORDS = /\b(get|move|bring|transfer|receive|deposit|send|top[- ]?up|add|fund|swap|convert|withdraw|bridge)\b/i;
const TO_PEXA = /\b(celo|pexa|my wallet|my pexa|here)\b/i;
/** Somebody else is going to pay you: "wants to send me", "is sending me", "going to pay me". */
const SENDS_ME = /\b((wants?|want|going|planning|trying|tryna|needs?|will|would like|about|gonna|intends?) to (send|pay|transfer|wire|give)|(is|are)? ?(sending|paying|transferring|wiring)|(sends?|pays?|transfers?) )\s*(me|to me)\b|\b(send|pay|transfer|wire)(ing|s)?\s+(some |the |it |money |usdc |crypto |funds |dollars )*to me\b/i;
/** "send 5 to joyful", anything naming a Pexa user: a payment, never a bridge. */
const PAYMENT_TARGET = /(@\w)|(\bsend\s+\$?\d[\d.,]*\s*(usdc|usd|dollars?|bucks)?\s+to\s+(?!me\b)\w+)/i;
/** The sender is on Celo or Pexa. */
const SAME_NETWORK = /\b(celo|pexa)\b/i;

export function parseBridgeIntent(text: string, askedForNetwork = false): BridgeIntent {
  const t = text.trim();
  if (!t || t.length > 220) return { kind: 'none' };

  const chain = findChain(t);
  const unsupported = t.match(UNSUPPORTED);
  const short = t.split(/\s+/).length <= 6;

  // Answering "which network will the USDC come from?" with just the network.
  if (askedForNetwork && short) {
    if (chain) return { kind: 'bridge', chain };
    if (unsupported) return { kind: 'unsupported', name: unsupported[1] };
    if (SAME_NETWORK.test(t)) return { kind: 'celo' };
  }

  if (PAYMENT_TARGET.test(t) && !BRIDGE_WORDS.test(t)) return { kind: 'none' };

  const hasBridgeWords = BRIDGE_WORDS.test(t);
  const mentionsMoney = /\b(usdc|usdt|stablecoins?|dollars?|money|funds|crypto|payment)\b/i.test(t);
  const fromSomeone = SENDS_ME.test(t) && !/\b(pay|paying|pays) me back\b/i.test(t);
  const movesToPexa = MOVE_WORDS.test(t) && TO_PEXA.test(t);
  const asksHow = /\bhow (do|can|to|could|should)\b/i.test(t) || /\bi (have|hold|got)\b/i.test(t);
  const fromWord = MOVE_WORDS.test(t) && /\bfrom\b/i.test(t);

  const wantsBridge = hasBridgeWords || fromSomeone || (mentionsMoney && (movesToPexa || asksHow)) || (!!chain && (movesToPexa || fromWord)) || (!!unsupported && fromWord);
  if (!wantsBridge) return { kind: 'none' };

  // The sender says they are on Celo / Pexa → the ordinary wallet address will do.
  if (!chain && !unsupported && fromSomeone && SAME_NETWORK.test(t) && !hasBridgeWords) return { kind: 'celo' };
  if (chain) return { kind: 'bridge', chain };
  if (unsupported) return { kind: 'unsupported', name: unsupported[1] };
  // "Money" talk with no network at all (e.g. "I have 20 dollars on Celo") isn't about bridging.
  if (!hasBridgeWords && !fromSomeone) return { kind: 'none' };
  return { kind: 'bridge', chain: null };
}
